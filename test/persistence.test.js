import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../lib/store.js";
const draft = {
  id: "unique-draft",
  name: "Campanha local",
  subject: "Teste",
  template: "welcome",
  listId: "demo-list",
};
test("persistência real em arquivo, reabertura sem reseed, edição e exclusão durável", () => {
  const dir = mkdtempSync(join(tmpdir(), "emails-"));
  const path = join(dir, "local.sqlite");
  let store;
  try {
    store = openStore(path);
    const before = store.state();
    let c = store.save("campaigns", draft);
    assert.equal(c.status, "Rascunho");
    assert.throws(() => store.save("campaigns", draft), /já existe/);
    c = store.save("campaigns", { ...c, subject: "Assunto atualizado" }, c.id);
    const template = store.one("templates", "welcome");
    store.save(
      "templates",
      { ...template, body: "Conteúdo persistido" },
      template.id,
    );
    const list = store.save("lists", { name: "CSV local" });
    store.importRecipients(list.id, [
      { email: " TESTE@example.com ", nome: "Pessoa Demo" },
    ]);
    store.close();
    store = openStore(path);
    assert.equal(store.one("campaigns", c.id).subject, "Assunto atualizado");
    assert.equal(store.one("templates", "welcome").body, "Conteúdo persistido");
    assert.equal(store.contacts(list.id)[0].email, "teste@example.com");
    assert.equal(store.all("templates").length, before.templates.length);
    store.remove("campaigns", c.id);
    store.close();
    store = openStore(path);
    assert.throws(() => store.one("campaigns", c.id), /inexistente/);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("importação atômica, deduplicação por lista e restrições de referências", () => {
  const s = openStore(":memory:");
  try {
    const l = s.save("lists", { name: "Lista A" });
    assert.throws(() => s.save("lists", { name: "lista a" }));
    assert.deepEqual(
      s.importRecipients(l.id, [
        { email: "a@example.com" },
        { email: "A@example.com" },
      ]),
      { added: 1, duplicates: 1 },
    );
    assert.throws(
      () =>
        s.importRecipients(l.id, [
          { email: "b@example.com" },
          { email: "inválido" },
        ]),
      /inválido/,
    );
    assert.equal(s.contacts(l.id).length, 1);
    const l2 = s.save("lists", { name: "Lista B" });
    assert.equal(
      s.importRecipients(l2.id, [{ email: "a@example.com" }]).added,
      1,
    );
    s.save("campaigns", { ...draft, listId: l.id });
    assert.throws(() => s.remove("lists", l.id));
    assert.throws(() => s.remove("templates", "welcome"));
    assert.equal(s.contacts(l.id)[0].consentimento, "Não verificado");
  } finally {
    s.close();
  }
});
test("conflito de versões e proteção de campanhas simuladas", () => {
  const s = openStore(":memory:");
  try {
    const c = s.save("campaigns", draft);
    s.save("campaigns", { ...c, subject: "Novo" }, c.id);
    assert.throws(() => s.save("campaigns", c, c.id), /outra aba/);
    assert.throws(() => s.remove("campaigns", "demo-1"), /rascunhos/);
    assert.throws(
      () =>
        s.save("campaigns", {
          name: "x",
          subject: "x",
          listId: "missing",
          template: "welcome",
        }),
      /inexistente/,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM suppressions").get().n,
      0,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM consent_events").get().n,
      0,
    );
  } finally {
    s.close();
  }
});
