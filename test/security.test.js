import { test } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { openStore } from "../lib/store.js";
test("API local persiste rascunhos e bloqueia CSRF, envio e mutações CRM", async () => {
  const { server, store } = createApp({ store: openStore(":memory:") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, extra = {}) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Local-Request": "1",
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const input = {
      id: "api-draft",
      name: "API",
      subject: "Teste",
      template: "welcome",
      listId: "demo-list",
    };
    let r = await request("/api/campaigns", "POST", input);
    assert.equal(r.status, 201);
    const c = await r.json();
    assert.equal(
      (await (await request("/api/campaigns/" + c.id)).json()).name,
      "API",
    );
    assert.equal((await request("/api/campaigns", "POST", input)).status, 409);
    assert.equal(
      (
        await request("/api/campaigns/" + c.id, "PUT", {
          ...c,
          name: "Editado",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/campaigns/" + c.id, "DELETE")).status,
      200,
    );
    assert.equal((await request("/api/campaigns/" + c.id)).status, 404);
    assert.equal(
      (
        await request("/api/campaigns", "POST", input, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise((resolve, reject) => {
      const req = http.get(
        base + "/api/state",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.equal(hostStatus, 403);
    assert.equal(
      (
        await request("/api/campaigns", "POST", input, {
          "X-Local-Request": "",
        })
      ).status,
      403,
    );
    for (const path of [
      "/api/send",
      "/api/smtp",
      "/api/crm/contacts",
      "/api/crm/companies",
    ])
      assert.equal((await request(path, "POST", {})).status, 403);
    assert.equal((await request("/api/crm/contacts")).status, 403);
    assert.equal((await request("/.env")).status, 404);
    assert.equal((await request("/data/app.sqlite")).status, 404);
    assert.equal(
      (await (await request("/health")).json()).sendingEnabled,
      false,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});
