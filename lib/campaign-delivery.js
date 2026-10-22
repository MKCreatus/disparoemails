import { randomUUID, createHash } from "node:crypto";
import { AppError, email } from "./store.js";
export const MAX_RECIPIENTS = 50,
  DAILY_LIMIT = 100;
const fail = (status, message) => {
  throw new AppError(status, message);
};
export function createDelivery({
  store,
  google,
  enabled = false,
  clock = Date.now,
  intervalMs = 2000,
}) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,requestId TEXT NOT NULL UNIQUE,campaignId TEXT NOT NULL,mode TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,sender TEXT NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL,permissionConfirmed INTEGER NOT NULL,selectionHash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS delivery_items(id TEXT PRIMARY KEY,deliveryId TEXT NOT NULL REFERENCES deliveries(id),email TEXT NOT NULL COLLATE NOCASE,nome TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,messageId TEXT,error TEXT,UNIQUE(deliveryId,email));`);
  // Uma operação em trânsito após queda pode já ter sido aceita pelo Gmail. Nunca repetir.
  db.exec(
    "UPDATE deliveries SET status='paused' WHERE id IN (SELECT deliveryId FROM delivery_items WHERE status='sending')",
  );
  db.exec(
    "UPDATE delivery_items SET status='unknown',error='Processo interrompido; confira Enviados antes de qualquer ação.' WHERE status='sending'",
  );
  let timer,
    busy = false,
    stopped = false;
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
  function selection(campaignId, input) {
    const c = store.one("campaigns", campaignId);
    if (c.status !== "Rascunho") fail(409, "Selecione um rascunho.");
    const t = store.one("templates", c.template);
    let rows = [];
    if (input.mode === "single")
      rows = [{ email: email(input.recipient), nome: "" }];
    else if (input.mode === "list") rows = store.contacts(c.listId);
    else fail(400, "Escolha um destinatário ou a lista da campanha.");
    const seen = new Set(),
      recipients = [];
    let suppressed = 0,
      demonstration = 0;
    for (const row of rows) {
      if (row.consentimento === "Demonstrativo") {
        demonstration++;
        continue;
      }
      const address = email(row.email);
      if (
        !/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
          address,
        )
      )
        fail(400, "Lista contém endereço inválido.");
      if (seen.has(address)) continue;
      seen.add(address);
      if (
        db
          .prepare("SELECT email FROM suppressions WHERE email=?")
          .get(address) ||
        db
          .prepare(
            "SELECT e.status FROM consent_events e JOIN recipients r ON r.id=e.recipientId WHERE r.email=? ORDER BY e.createdAt DESC,e.rowid DESC LIMIT 1",
          )
          .get(address)?.status === "revoked"
      ) {
        suppressed++;
        continue;
      }
      recipients.push({ email: address, nome: row.nome || "" });
    }
    if (!recipients.length)
      fail(
        400,
        "Nenhum destinatário elegível; revise a lista e as supressões.",
      );
    if (recipients.length > MAX_RECIPIENTS)
      fail(400, "Limite inicial: 50 destinatários por envio.");
    if (
      !c.subject.trim() ||
      /[\r\n]/.test(c.subject) ||
      c.subject.length > 200 ||
      !t.body.trim()
    )
      fail(400, "Revise assunto e conteúdo.");
    const sender = google.connection().sender;
    const selectionHash = createHash("sha256")
      .update(JSON.stringify({ c, template: t, sender, recipients }))
      .digest("hex");
    return {
      campaignId: c.id,
      campaignName: c.name,
      mode: input.mode,
      subject: c.subject,
      body: t.body,
      sender,
      recipients,
      suppressed,
      demonstration,
      selectionHash,
    };
  }
  function preview(campaignId, input) {
    const s = selection(campaignId, input);
    return {
      ...s,
      count: s.recipients.length,
      maxRecipients: MAX_RECIPIENTS,
      dailyLimit: DAILY_LIMIT,
      connected: google.connection().connected,
      enabled,
    };
  }
  function enqueue(campaignId, input) {
    if (!enabled) fail(403, "Envio de campanhas desativado no backend.");
    if (!google.connection().connected)
      fail(409, "Conecte o Google Workspace antes de enviar.");
    if (input.confirmed !== true || input.permissionConfirmed !== true)
      fail(400, "Confirme a revisão e a autorização dos destinatários.");
    if (
      typeof input.requestId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(input.requestId)
    )
      fail(400, "Identificador de envio inválido.");
    return tx(() => {
      const existing = db
        .prepare("SELECT id,campaignId FROM deliveries WHERE requestId=?")
        .get(input.requestId);
      if (existing) {
        if (existing.campaignId !== campaignId)
          fail(409, "Identificador já utilizado.");
        return get(existing.id);
      }
      if (
        db
          .prepare("SELECT id FROM deliveries WHERE campaignId=?")
          .get(campaignId)
      )
        fail(
          409,
          "Esta campanha já tem um envio registrado. Crie outro rascunho para uma nova campanha.",
        );
      const s = selection(campaignId, input);
      if (s.selectionHash !== input.selectionHash)
        fail(409, "Campanha ou lista mudou. Gere uma nova prévia.");
      const usage = db
        .prepare(
          "SELECT count(*) AS n FROM delivery_items i JOIN deliveries d ON d.id=i.deliveryId WHERE d.createdAt>?",
        )
        .get(clock() - 86400_000).n;
      if (usage + s.recipients.length > DAILY_LIMIT)
        fail(429, "Limite local de 100 destinatários em 24 horas atingido.");
      const id = randomUUID();
      db.prepare("INSERT INTO deliveries VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
        id,
        input.requestId,
        campaignId,
        s.mode,
        s.subject,
        s.body,
        s.sender,
        "queued",
        clock(),
        1,
        s.selectionHash,
      );
      for (const r of s.recipients)
        db.prepare(
          "INSERT INTO delivery_items(id,deliveryId,email,nome,status) VALUES (?,?,?,?,'pending')",
        ).run(randomUUID(), id, r.email, r.nome);
      return get(id);
    });
  }
  function get(id) {
    const row = db.prepare("SELECT * FROM deliveries WHERE id=?").get(id);
    if (!row) fail(404, "Envio não encontrado.");
    return {
      ...row,
      items: db
        .prepare(
          "SELECT id,email,status,error FROM delivery_items WHERE deliveryId=? ORDER BY rowid",
        )
        .all(id),
    };
  }
  function reconcile() {
    for (const row of db
      .prepare(
        "SELECT id FROM deliveries WHERE status IN ('queued','running','paused')",
      )
      .all()) {
      const items = db
          .prepare("SELECT status FROM delivery_items WHERE deliveryId=?")
          .all(row.id),
        pending = items.some((x) => ["pending", "sending"].includes(x.status));
      if (!pending)
        db.prepare("UPDATE deliveries SET status=? WHERE id=?").run(
          items.some((x) => x.status === "unknown")
            ? "needs_review"
            : "completed",
          row.id,
        );
    }
  }
  async function tick() {
    if (busy || stopped || !enabled) return;
    busy = true;
    try {
      reconcile();
      const item = db
        .prepare(
          "SELECT i.*,d.subject,d.body,d.sender FROM delivery_items i JOIN deliveries d ON d.id=i.deliveryId WHERE i.status='pending' AND d.status IN ('queued','running') ORDER BY d.createdAt,i.rowid LIMIT 1",
        )
        .get();
      if (!item) return;
      if (
        !google.connection().connected ||
        google.connection().sender !== item.sender
      ) {
        db.prepare("UPDATE deliveries SET status='paused' WHERE id=?").run(
          item.deliveryId,
        );
        return;
      }
      if (
        db
          .prepare("SELECT email FROM suppressions WHERE email=?")
          .get(item.email) ||
        db
          .prepare(
            "SELECT e.status FROM consent_events e JOIN recipients r ON r.id=e.recipientId WHERE r.email=? ORDER BY e.createdAt DESC,e.rowid DESC LIMIT 1",
          )
          .get(item.email)?.status === "revoked"
      ) {
        db.prepare(
          "UPDATE delivery_items SET status='suppressed' WHERE id=?",
        ).run(item.id);
        reconcile();
        return;
      }
      const claimed = db
        .prepare(
          "UPDATE delivery_items SET status='sending' WHERE id=? AND status='pending'",
        )
        .run(item.id);
      if (!claimed.changes) return;
      db.prepare("UPDATE deliveries SET status='running' WHERE id=?").run(
        item.deliveryId,
      );
      try {
        const r = await google.sendCampaignMessage({
          recipient: item.email,
          subject: item.subject
            .replaceAll("{{nome}}", item.nome)
            .replace(/[\r\n]/g, " "),
          body: item.body.replaceAll("{{nome}}", item.nome),
        });
        db.prepare(
          "UPDATE delivery_items SET status='accepted',messageId=? WHERE id=?",
        ).run(r.messageId, item.id);
      } catch {
        db.prepare(
          "UPDATE delivery_items SET status='unknown',error='Sem confirmação; confira Enviados. Não haverá reenvio automático.' WHERE id=?",
        ).run(item.id);
        db.prepare("UPDATE deliveries SET status='paused' WHERE id=?").run(
          item.deliveryId,
        );
      }
      reconcile();
    } finally {
      busy = false;
    }
  }
  function cancel(id) {
    get(id);
    db.prepare(
      "UPDATE delivery_items SET status='cancelled' WHERE deliveryId=? AND status='pending'",
    ).run(id);
    reconcile();
    return get(id);
  }
  function resume(id) {
    const r = get(id);
    if (r.status !== "paused") fail(409, "Envio não está pausado.");
    if (
      !google.connection().connected ||
      google.connection().sender !== r.sender
    )
      fail(409, "Reconecte a conta remetente original.");
    db.prepare("UPDATE deliveries SET status='queued' WHERE id=?").run(id);
    return get(id);
  }
  function list() {
    reconcile();
    return db
      .prepare(
        "SELECT id,campaignId,status,createdAt FROM deliveries ORDER BY createdAt DESC",
      )
      .all()
      .map((r) => get(r.id));
  }
  function suppress(address, reason) {
    address = email(address);
    if (typeof reason !== "string" || !reason.trim() || reason.length > 200)
      fail(400, "Informe motivo da supressão.");
    db.prepare(
      "INSERT INTO suppressions VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET reason=excluded.reason",
    ).run(address, reason, new Date(clock()).toISOString());
  }
  reconcile();
  return {
    preview,
    enqueue,
    get,
    list,
    tick,
    cancel,
    resume,
    suppress,
    suppressions: () =>
      db.prepare("SELECT * FROM suppressions ORDER BY createdAt DESC").all(),
    start: () => {
      if (!timer) {
        stopped = false;
        timer = setInterval(() => tick().catch(() => {}), intervalMs);
        timer.unref();
      }
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      timer = null;
      while (busy) await new Promise((r) => setTimeout(r, 10));
    },
  };
}
