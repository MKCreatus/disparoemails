import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "../public/domain.js";
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (s, m) => {
  throw new AppError(s, m);
};
function text(v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, "Campo textual inválido.");
  return v.trim();
}
export function email(v) {
  const e = text(v, 254).toLowerCase();
  if (
    !/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e)
  )
    fail(400, "E-mail inválido.");
  return e;
}
export function openStore(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS lists(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
 CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,subject TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,name TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Rascunho','Simulada')),listId TEXT REFERENCES lists(id),template TEXT REFERENCES templates(id),audience INTEGER DEFAULT 0,delivered INTEGER DEFAULT 0,opened INTEGER DEFAULT 0,clicked INTEGER DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS recipients(id TEXT PRIMARY KEY,listId TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,email TEXT NOT NULL COLLATE NOCASE,nome TEXT NOT NULL DEFAULT '',empresa TEXT NOT NULL DEFAULT '',consentimento TEXT NOT NULL DEFAULT 'Não verificado',UNIQUE(listId,email));
 CREATE TABLE IF NOT EXISTS suppressions(email TEXT PRIMARY KEY COLLATE NOCASE,reason TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS consent_events(id TEXT PRIMARY KEY,recipientId TEXT NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('unknown','granted','revoked')),evidence TEXT,createdAt TEXT NOT NULL);`);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  if (!db.prepare("SELECT version FROM schema_version WHERE version=1").get())
    tx(() => {
      const s = seed();
      db.prepare("INSERT INTO lists VALUES (?,?)").run(
        "demo-list",
        "Lista demonstrativa",
      );
      for (const t of s.templates)
        db.prepare(
          "INSERT INTO templates(id,name,subject,body) VALUES (?,?,?,?)",
        ).run(t.id, t.name, t.subject, t.body);
      for (const c of s.campaigns)
        db.prepare(
          "INSERT INTO campaigns(id,name,subject,status,listId,template,audience,delivered,opened,clicked) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          c.id,
          c.name,
          c.subject,
          c.status,
          "demo-list",
          "welcome",
          c.audience,
          c.delivered,
          c.opened,
          c.clicked,
        );
      for (const c of s.contacts)
        db.prepare(
          "INSERT INTO recipients(id,listId,email,nome,empresa,consentimento) VALUES (?,?,?,?,?,?)",
        ).run(
          randomUUID(),
          "demo-list",
          c.email,
          c.nome,
          c.empresa,
          c.consentimento,
        );
      db.prepare("INSERT INTO schema_version VALUES (1)").run();
    });
  const tables = new Set(["campaigns", "templates", "lists"]);
  function all(resource) {
    if (!tables.has(resource)) fail(404, "Recurso inexistente.");
    return db.prepare(`SELECT * FROM ${resource} ORDER BY rowid`).all();
  }
  function one(resource, id) {
    if (!tables.has(resource)) fail(404, "Recurso inexistente.");
    return (
      db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(id) ||
      fail(404, "Registro inexistente.")
    );
  }
  function hasDelivery(id) {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='deliveries'",
        )
        .get() &&
      db.prepare("SELECT id FROM deliveries WHERE campaignId=?").get(id)
    );
  }
  function save(resource, input, id) {
    return tx(() => {
      let current;
      if (id) {
        current = one(resource, id);
        if (resource === "campaigns" && hasDelivery(id))
          fail(409, "Campanha com envio registrado não pode ser alterada.");
        if (resource === "campaigns" && current.status !== "Rascunho")
          fail(409, "Somente rascunhos podem ser alterados.");
        if (resource !== "lists" && input.version !== current.version)
          fail(409, "Registro alterado em outra aba. Atualize a página.");
      } else {
        id = input.id || randomUUID();
        if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
          fail(400, "Identificador inválido.");
        if (db.prepare(`SELECT id FROM ${resource} WHERE id=?`).get(id))
          fail(409, "Identificador já existe.");
      }
      const name = text(input.name, 120);
      if (resource === "lists") {
        db.prepare(
          id && current
            ? "UPDATE lists SET name=? WHERE id=?"
            : "INSERT INTO lists(name,id) VALUES (?,?)",
        ).run(name, id);
      } else if (resource === "templates") {
        const subject = text(input.subject),
          body = text(input.body, 20000);
        if (current)
          db.prepare(
            "UPDATE templates SET name=?,subject=?,body=?,version=version+1 WHERE id=?",
          ).run(name, subject, body, id);
        else
          db.prepare(
            "INSERT INTO templates(name,subject,body,id) VALUES (?,?,?,?)",
          ).run(name, subject, body, id);
      } else {
        const subject = text(input.subject),
          listId = input.listId,
          template = input.template;
        one("lists", listId);
        one("templates", template);
        const audience = db
          .prepare("SELECT count(*) AS n FROM recipients WHERE listId=?")
          .get(listId).n;
        if (current)
          db.prepare(
            "UPDATE campaigns SET name=?,subject=?,listId=?,template=?,audience=?,version=version+1 WHERE id=?",
          ).run(name, subject, listId, template, audience, id);
        else
          db.prepare(
            "INSERT INTO campaigns(id,name,subject,listId,template,status,audience) VALUES (?,?,?,?,?,'Rascunho',?)",
          ).run(id, name, subject, listId, template, audience);
      }
      return one(resource, id);
    });
  }
  function remove(resource, id) {
    return tx(() => {
      const r = one(resource, id);
      if (resource === "campaigns" && hasDelivery(id))
        fail(409, "Campanha com envio registrado não pode ser excluída.");
      if (resource === "campaigns" && r.status !== "Rascunho")
        fail(409, "Somente rascunhos podem ser excluídos.");
      db.prepare(`DELETE FROM ${resource} WHERE id=?`).run(id);
    });
  }
  function importRecipients(listId, contacts) {
    one("lists", listId);
    if (!Array.isArray(contacts) || contacts.length > 10000)
      fail(400, "Lista inválida ou acima de 10000 contatos.");
    return tx(() => {
      let added = 0,
        duplicates = 0;
      for (const c of contacts) {
        const e = email(c.email);
        const nome = c.nome ? text(c.nome, 200) : "",
          empresa = c.empresa ? text(c.empresa, 200) : "";
        const r = db
          .prepare(
            "INSERT INTO recipients(id,listId,email,nome,empresa) VALUES (?,?,?,?,?) ON CONFLICT(listId,email) DO NOTHING",
          )
          .run(randomUUID(), listId, e, nome, empresa);
        if (r.changes) added++;
        else duplicates++;
      }
      db.prepare(
        "UPDATE campaigns SET audience=(SELECT count(*) FROM recipients WHERE listId=?),version=version+1 WHERE listId=? AND status='Rascunho'",
      ).run(listId, listId);
      return { added, duplicates };
    });
  }
  return {
    db,
    all,
    one,
    save,
    remove,
    importRecipients,
    contacts: (listId) => {
      one("lists", listId);
      return db
        .prepare("SELECT * FROM recipients WHERE listId=? ORDER BY rowid")
        .all(listId);
    },
    state: () => ({
      campaigns: all("campaigns"),
      templates: all("templates"),
      lists: all("lists"),
      contacts: db.prepare("SELECT * FROM recipients ORDER BY rowid").all(),
    }),
    close: () => db.close(),
  };
}
