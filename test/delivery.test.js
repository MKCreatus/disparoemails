import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore } from "../lib/store.js";
import { createDelivery } from "../lib/campaign-delivery.js";
function setup() {
  const store = openStore(":memory:");
  const sent = [];
  let fail = false;
  const google = {
    connection: () => ({ sender: "sender@example.com", connected: true }),
    async sendCampaignMessage(m) {
      sent.push(m);
      if (fail) throw new Error("unknown");
      return { messageId: randomUUID() };
    },
  };
  const d = createDelivery({ store, google, enabled: true });
  const list = store.save("lists", { name: "Lista real de teste" });
  store.importRecipients(list.id, [
    { email: "a@example.com", nome: "Ana" },
    { email: "b@example.com", nome: "Bruno" },
  ]);
  const campaign = store.save("campaigns", {
    name: "Campanha",
    subject: "Olá",
    listId: list.id,
    template: "welcome",
  });
  const enqueue = (input = { mode: "list" }) => {
    const p = d.preview(campaign.id, input);
    return d.enqueue(campaign.id, {
      ...input,
      selectionHash: p.selectionHash,
      requestId: randomUUID(),
      confirmed: true,
      permissionConfirmed: true,
    });
  };
  return {
    store,
    d,
    list,
    campaign,
    enqueue,
    sent,
    google,
    fail: () => {
      fail = true;
    },
  };
}
test("lista é deduplicada, suprimida, confirmada e enviada individualmente apenas uma vez", async () => {
  const f = setup();
  try {
    assert.equal(f.sent.length, 0);
    f.d.suppress("b@example.com", "Descadastro");
    const p = f.d.preview(f.campaign.id, { mode: "list" });
    assert.equal(p.count, 1);
    assert.equal(p.suppressed, 1);
    assert.throws(
      () => f.d.enqueue(f.campaign.id, { mode: "list" }),
      /Confirme/,
    );
    const input = {
      mode: "list",
      selectionHash: p.selectionHash,
      requestId: randomUUID(),
      confirmed: true,
      permissionConfirmed: true,
    };
    const job = f.d.enqueue(f.campaign.id, input);
    assert.equal(f.d.enqueue(f.campaign.id, input).id, job.id);
    assert.equal(f.sent.length, 0);
    await f.d.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].recipient, "a@example.com");
    assert.match(f.sent[0].body, /Ana/);
    await f.d.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(f.d.get(job.id).status, "completed");
    assert.throws(
      () => f.store.remove("campaigns", f.campaign.id),
      /envio registrado/,
    );
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("destinatário único não usa a lista; prévia alterada invalida confirmação", async () => {
  const f = setup();
  try {
    const p = f.d.preview(f.campaign.id, {
      mode: "single",
      recipient: "chosen@example.org",
    });
    assert.equal(p.count, 1);
    assert.equal(p.recipients[0].email, "chosen@example.org");
    const template = f.store.one("templates", "welcome");
    f.store.save(
      "templates",
      { ...template, body: "Novo conteúdo" },
      template.id,
    );
    assert.throws(
      () =>
        f.d.enqueue(f.campaign.id, {
          mode: "single",
          recipient: "chosen@example.org",
          selectionHash: p.selectionHash,
          requestId: randomUUID(),
          confirmed: true,
          permissionConfirmed: true,
        }),
      /mudou/,
    );
    const job = f.enqueue({ mode: "single", recipient: "chosen@example.org" });
    await f.d.tick();
    assert.equal(f.sent[0].recipient, "chosen@example.org");
    assert.equal(f.d.get(job.id).items.length, 1);
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("falha pausa os pendentes, nunca repete resultado desconhecido e permite cancelar", async () => {
  const f = setup();
  try {
    const job = f.enqueue();
    f.fail();
    await f.d.tick();
    assert.equal(f.d.get(job.id).status, "paused");
    await f.d.tick();
    assert.equal(f.sent.length, 1);
    f.d.cancel(job.id);
    assert.deepEqual(
      f.d.get(job.id).items.map((i) => i.status),
      ["unknown", "cancelled"],
    );
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("reinício não reenvia item que estava em trânsito", async () => {
  const f = setup();
  try {
    const job = f.enqueue();
    f.store.db
      .prepare("UPDATE delivery_items SET status='sending' WHERE id=?")
      .run(job.items[0].id);
    const reopened = createDelivery({
      store: f.store,
      google: f.google,
      enabled: true,
    });
    assert.equal(reopened.get(job.id).status, "paused");
    await reopened.tick();
    assert.equal(f.sent.length, 0);
    reopened.resume(job.id);
    await reopened.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].recipient, "b@example.com");
    assert.equal(reopened.get(job.id).items[0].status, "unknown");
    await reopened.stop();
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("limites por lista e por 24h são aplicados antes de qualquer envio", async () => {
  const f = setup();
  try {
    const many = Array.from({ length: 49 }, (_, i) => ({
      email: `x${i}@example.com`,
    }));
    f.store.importRecipients(f.list.id, many);
    assert.throws(
      () => f.d.preview(f.campaign.id, { mode: "list" }),
      /50 destinatários/,
    );
    assert.equal(f.sent.length, 0);
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("backend desligado e contatos demonstrativos não podem ser enviados", async () => {
  const f = setup();
  try {
    const disabled = createDelivery({
      store: f.store,
      google: f.google,
      enabled: false,
    });
    assert.throws(() => disabled.enqueue(f.campaign.id, {}), /desativado/);
    assert.throws(
      () => f.d.preview("demo-2", { mode: "list" }),
      /Nenhum destinatário/,
    );
    await disabled.stop();
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("cota de 100 destinatários por janela móvel de 24h inclui mensagens ainda pendentes", async () => {
  const f = setup();
  try {
    f.store.importRecipients(
      f.list.id,
      Array.from({ length: 48 }, (_, i) => ({ email: `q${i}@example.com` })),
    );
    f.enqueue();
    const second = f.store.save("campaigns", {
      name: "Segunda",
      subject: "Teste",
      listId: f.list.id,
      template: "welcome",
    });
    let p = f.d.preview(second.id, { mode: "list" });
    f.d.enqueue(second.id, {
      mode: "list",
      selectionHash: p.selectionHash,
      requestId: randomUUID(),
      confirmed: true,
      permissionConfirmed: true,
    });
    const third = f.store.save("campaigns", {
      name: "Terceira",
      subject: "Teste",
      listId: f.list.id,
      template: "welcome",
    });
    p = f.d.preview(third.id, {
      mode: "single",
      recipient: "last@example.org",
    });
    assert.throws(
      () =>
        f.d.enqueue(third.id, {
          mode: "single",
          recipient: "last@example.org",
          selectionHash: p.selectionHash,
          requestId: randomUUID(),
          confirmed: true,
          permissionConfirmed: true,
        }),
      /100 destinatários/,
    );
    assert.equal(f.sent.length, 0);
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("supressão incluída depois da confirmação bloqueia o destinatário pendente", async () => {
  const f = setup();
  try {
    const job = f.enqueue();
    f.d.suppress("a@example.com", "Opt-out posterior");
    await f.d.tick();
    await f.d.tick();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].recipient, "b@example.com");
    assert.equal(f.d.get(job.id).items[0].status, "suppressed");
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
test("revogação de consentimento é respeitada antes e depois de confirmar a fila", async () => {
  const f = setup();
  try {
    const recipient = f.store.contacts(f.list.id)[0];
    f.store.db
      .prepare("INSERT INTO consent_events VALUES (?,?,?,?,?)")
      .run(
        randomUUID(),
        recipient.id,
        "revoked",
        "Solicitação",
        new Date().toISOString(),
      );
    const p = f.d.preview(f.campaign.id, { mode: "list" });
    assert.equal(p.suppressed, 1);
    assert.equal(p.count, 1);
    const job = f.enqueue();
    const second = f.store.contacts(f.list.id)[1];
    f.store.db
      .prepare("INSERT INTO consent_events VALUES (?,?,?,?,?)")
      .run(
        randomUUID(),
        second.id,
        "revoked",
        "Solicitação",
        new Date().toISOString(),
      );
    await f.d.tick();
    assert.equal(f.sent.length, 0);
    assert.equal(f.d.get(job.id).items[0].status, "suppressed");
  } finally {
    await f.d.stop();
    f.store.close();
  }
});
