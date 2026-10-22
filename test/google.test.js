import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoogleTest } from "../lib/google-oauth.js";
const SENDER = "sender@example.com",
  RECIPIENT = "recipient@example.com";
async function fixture({
  enabled = true,
  identityEmail = SENDER,
  failSend = false,
  wrongNonce = false,
  expectedRecipient = RECIPIENT,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gmail-test-"));
  const calls = { exchange: 0, send: 0 };
  let auth;
  const client = {
    generateAuthUrl(options) {
      auth = options;
      return (
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({ state: options.state })
      );
    },
    async getToken() {
      calls.exchange++;
      return {
        tokens: {
          refresh_token: "dummy-refresh-sensitive",
          access_token: "dummy-access-sensitive",
          id_token: "dummy-id",
          scope: "openid email https://www.googleapis.com/auth/gmail.send",
        },
      };
    },
    async verifyIdToken() {
      return {
        getPayload: () => ({
          email: identityEmail,
          email_verified: true,
          hd: "example.com",
          nonce: wrongNonce ? "wrong-nonce" : auth.nonce,
        }),
      };
    },
    setCredentials(value) {
      assert.equal(value.refresh_token, "dummy-refresh-sensitive");
    },
    async request(options) {
      calls.send++;
      assert.equal(options.method, "POST");
      assert.equal(options.retry, false);
      const raw = Buffer.from(options.data.raw, "base64url").toString();
      assert.match(raw, new RegExp("From: " + SENDER));
      assert.match(raw, new RegExp("To: " + expectedRecipient));
      assert.ok(!raw.includes("Bcc:"));
      if (failSend) throw new Error("dummy-refresh-sensitive");
      return { data: { id: "test-message" } };
    },
  };
  let handler, server, origin;
  server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch {
      res.writeHead(500);
      res.end("Falha");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  let app = createGoogleTest({
    origin,
    dataDir: dir,
    ownerId: "75",
    sender: SENDER,
    enabled,
    client,
    clientId: "dummy-client",
  });
  handler = app.handler;
  const request = (path, options = {}) =>
    fetch(origin + path, {
      redirect: "manual",
      body:
        options.method === "POST"
          ? JSON.stringify({ recipient: RECIPIENT, confirmed: true })
          : undefined,
      ...options,
      headers: {
        "X-Vibe-User-Id": "75",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  async function connect() {
    const start = await request("/oauth/google/start");
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    );
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await request(
      "/oauth/google/callback?state=" + state + "&code=fake-code",
      { headers: { Cookie: cookie } },
    );
    return { callback, state, cookie };
  }
  async function session() {
    const r = await request("/api/google/status");
    const data = await r.json();
    return { data, cookie: r.headers.get("set-cookie").split(";")[0] };
  }
  return {
    dir,
    calls,
    request,
    connect,
    session,
    origin,
    reopen: () => {
      app.close();
      app = createGoogleTest({
        origin,
        dataDir: dir,
        ownerId: "75",
        sender: SENDER,
        enabled,
        client,
        clientId: "dummy-client",
      });
      handler = app.handler;
    },
    close: async () => {
      await new Promise((r) => server.close(r));
      app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("OAuth verifica proprietário, state, cookie, nonce, conta e não vaza tokens", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request("/api/google/status", {
          headers: { "X-Vibe-User-Id": "999" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.request("/oauth/google/callback?state=invalid&code=fake"))
        .status,
      400,
    );
    assert.equal(f.calls.exchange, 0);
    const { callback, state, cookie } = await f.connect();
    assert.equal(callback.status, 303);
    assert.equal(
      (
        await f.request(
          "/oauth/google/callback?state=" + state + "&code=fake",
          { headers: { Cookie: cookie } },
        )
      ).status,
      400,
    );
    assert.equal(f.calls.exchange, 1);
    const { data } = await f.session();
    assert.equal(data.connected, true);
    assert.ok(!JSON.stringify(data).includes("dummy-refresh-sensitive"));
    assert.ok(
      !readFileSync(join(f.dir, "oauth.sqlite")).includes(
        Buffer.from("dummy-refresh-sensitive"),
      ),
    );
    f.reopen();
    assert.equal((await f.session()).data.connected, true);
  } finally {
    await f.close();
  }
});
test("conta diferente do remetente não pode conectar", async () => {
  const f = await fixture({ identityEmail: "other@example.com" });
  try {
    assert.equal((await f.connect()).callback.status, 403);
    assert.equal((await f.session()).data.connected, false);
    assert.equal(f.calls.send, 0);
  } finally {
    await f.close();
  }
});
test("envio único manual: CSRF, origem, conteúdo fixo e deduplicação persistente", async () => {
  const f = await fixture();
  try {
    await f.connect();
    const { data, cookie } = await f.session();
    const headers = {
      Cookie: cookie,
      "X-Test-CSRF": data.csrf,
      Origin: f.origin,
    };
    assert.equal(
      (
        await f.request("/api/google/send-test", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/google/send-test", {
          method: "POST",
          headers: { Cookie: cookie, Origin: f.origin },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/google/send-test", {
          method: "POST",
          headers,
          body: '{"to":"other@example.com"}',
        })
      ).status,
      400,
    );
    assert.equal(f.calls.send, 0);
    const result = await f.request("/api/google/send-test", {
      method: "POST",
      headers,
    });
    assert.equal(result.status, 200);
    assert.equal(f.calls.send, 1);
    assert.equal(
      (await f.request("/api/google/send-test", { method: "POST", headers }))
        .status,
      409,
    );
    assert.equal(f.calls.send, 1);
    f.reopen();
    const next = await f.session();
    assert.equal(next.data.used, true);
    assert.equal(
      (
        await f.request("/api/google/send-test", {
          method: "POST",
          headers: {
            Cookie: next.cookie,
            Origin: f.origin,
            "X-Test-CSRF": next.data.csrf,
          },
        })
      ).status,
      409,
    );
    assert.equal(f.calls.send, 1);
  } finally {
    await f.close();
  }
});
test("timeout não permite reenvio e botão desabilitado no backend impede transmissão", async () => {
  for (const config of [{ failSend: true }, { enabled: false }]) {
    const f = await fixture(config);
    try {
      await f.connect();
      const { data, cookie } = await f.session();
      const options = {
        method: "POST",
        headers: { Cookie: cookie, Origin: f.origin, "X-Test-CSRF": data.csrf },
      };
      const r = await f.request("/api/google/send-test", options);
      assert.equal(r.status, config.failSend ? 502 : 403);
      assert.ok(!(await r.text()).includes("dummy-refresh-sensitive"));
      if (config.failSend) {
        assert.equal(
          (await f.request("/api/google/send-test", options)).status,
          409,
        );
        assert.equal(f.calls.send, 1);
      } else assert.equal(f.calls.send, 0);
    } finally {
      await f.close();
    }
  }
});

test("state sem cookie e nonce incorreto são recusados antes de vincular conta", async () => {
  const f = await fixture();
  try {
    const start = await f.request("/oauth/google/start");
    const state = new URL(start.headers.get("location")).searchParams.get(
      "state",
    );
    assert.equal(
      (await f.request("/oauth/google/callback?state=" + state + "&code=fake"))
        .status,
      400,
    );
    assert.equal(f.calls.exchange, 0);
  } finally {
    await f.close();
  }
  const bad = await fixture({ wrongNonce: true });
  try {
    assert.equal((await bad.connect()).callback.status, 403);
    assert.equal((await bad.session()).data.connected, false);
  } finally {
    await bad.close();
  }
});

test("destinatário escolhido admite só um endereço e rejeita cópias, listas e injeção de headers", async () => {
  const f = await fixture({ expectedRecipient: "chosen@example.org" });
  try {
    await f.connect();
    const { data, cookie } = await f.session();
    const headers = {
      Cookie: cookie,
      Origin: f.origin,
      "X-Test-CSRF": data.csrf,
    };
    for (const input of [
      { recipient: ["a@example.com"], confirmed: true },
      { recipient: "a@example.com,b@example.com", confirmed: true },
      { recipient: "a@example.com\r\nBcc: b@example.com", confirmed: true },
      { recipient: "a@example.com", confirmed: false },
      { recipient: "a@example.com", confirmed: true, cc: "b@example.com" },
      {
        recipient: "a@example.com",
        confirmed: true,
        from: "other@example.com",
      },
    ]) {
      assert.equal(
        (
          await f.request("/api/google/send-test", {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          })
        ).status,
        400,
      );
    }
    assert.equal(f.calls.send, 0);
    assert.equal(
      (
        await f.request("/api/google/send-test", {
          method: "POST",
          headers,
          body: JSON.stringify({
            recipient: "chosen@example.org",
            confirmed: true,
          }),
        })
      ).status,
      200,
    );
    assert.equal(f.calls.send, 1);
  } finally {
    await f.close();
  }
});
