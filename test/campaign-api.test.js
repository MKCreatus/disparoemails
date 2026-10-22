import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApplication } from "../server.js";
import { openStore } from "../lib/store.js";
test("API exige proprietário e CSRF, persiste rascunhos, faz prévia e não envia ao enfileirar", async () => {
  const sent = [];
  const google = {
    authorize: (req, mutation = false) =>
      req.headers["x-vibe-user-id"] === "75" &&
      (!mutation ||
        (req.headers.origin === base &&
          req.headers["x-test-csrf"] === "test-csrf")),
    handler: async () => {},
    connection: () => ({
      connected: true,
      configured: true,
      sender: "sender@example.com",
    }),
    sendCampaignMessage: async (m) => {
      sent.push(m);
      return { messageId: "fake" };
    },
    close: () => {},
  };
  const app = createApplication({
    google,
    store: openStore(":memory:"),
    enabled: true,
    autoStart: false,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = (path, method = "GET", value, extra = {}) =>
    fetch(base + path, {
      method,
      headers: {
        "X-Vibe-User-Id": "75",
        "X-Test-CSRF": "test-csrf",
        Origin: base,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  try {
    assert.equal(
      (await call("/api/state", "GET", null, { "X-Vibe-User-Id": "99" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/lists",
          "POST",
          { name: "Blocked" },
          { "X-Test-CSRF": "wrong" },
        )
      ).status,
      403,
    );
    const r = await call("/api/campaigns", "POST", {
      name: "API draft",
      subject: "Real subject",
      listId: "demo-list",
      template: "welcome",
    });
    assert.equal(r.status, 201);
    const c = await r.json();
    const p = await (
      await call(`/api/campaigns/${c.id}/preview`, "POST", {
        mode: "single",
        recipient: "recipient@example.com",
      })
    ).json();
    const queued = await call(`/api/campaigns/${c.id}/send`, "POST", {
      mode: "single",
      recipient: "recipient@example.com",
      selectionHash: p.selectionHash,
      requestId: randomUUID(),
      confirmed: true,
      permissionConfirmed: true,
    });
    assert.equal(queued.status, 201);
    assert.equal(sent.length, 0);
    const state = await (await call("/api/state")).json();
    assert.equal(state.deliveries.length, 1);
    assert.equal((await call("/api/crm/contacts", "POST", {})).status, 403);
    assert.equal((await call("/.env")).status, 404);
  } finally {
    await app.close();
  }
});
