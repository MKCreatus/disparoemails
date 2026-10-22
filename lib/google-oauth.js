import { OAuth2Client } from "google-auth-library";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
export const CALLBACK = "/oauth/google/callback";
const scope = "https://www.googleapis.com/auth/gmail.send";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(32).toString("base64url");
export function createGoogleTest({
  origin = process.env.APP_ORIGIN || "http://localhost:3000",
  ownerId = process.env.OAUTH_OWNER_USER_ID || "",
  sender = process.env.TEST_EMAIL_SENDER || "",
  enabled = process.env.TEST_EMAIL_ENABLED === "true",
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  dataDir = process.env.OAUTH_DATA_DIR || "/opt/data/google-test",
  client,
  clock = Date.now,
} = {}) {
  const SENDER = sender.trim().toLowerCase();
  const validEmail = (e) =>
    /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
      e,
    ) && e.length <= 254;
  if (SENDER && !validEmail(SENDER))
    throw new Error("Endereços de teste inválidos.");
  const oauth =
    client || new OAuth2Client(clientId, clientSecret, origin + CALLBACK);
  const configured = Boolean(SENDER && (client || (clientId && clientSecret)));
  enabled = enabled && configured;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const keyPath = dataDir + "/encryption.key";
  try {
    writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Armazenamento OAuth indisponível.");
  const db = new DatabaseSync(dataDir + "/oauth.sqlite");
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY CHECK(id=1),encrypted TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,createdAt TEXT NOT NULL,messageId TEXT);",
  );
  if (
    !db
      .prepare("PRAGMA table_info(attempts)")
      .all()
      .some((c) => c.name === "recipient")
  )
    db.exec("ALTER TABLE attempts ADD COLUMN recipient TEXT");
  const encrypt = (value) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const content = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), content]).toString("base64");
  };
  const decrypt = (value) => {
    const b = Buffer.from(value, "base64"),
      dec = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    dec.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([dec.update(b.subarray(28)), dec.final()]).toString(),
    );
  };
  const loadAccount = () => {
    const row = db.prepare("SELECT encrypted FROM account WHERE id=1").get();
    if (!row) return null;
    const data = decrypt(row.encrypted);
    return data.sender === SENDER ? data.tokens : null;
  };
  const states = new Map(),
    sessions = new Map();
  const cookies = (req) =>
    Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .map((c) => c.trim().split("="))
        .filter((a) => a.length === 2),
    );
  const cookie = (res, name, value, maxAge) =>
    res.setHeader(
      "Set-Cookie",
      `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    );
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify(data));
  };
  const html = (res, status, message) => {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    res.end(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Google Workspace</title><body><h1>Google Workspace</h1><p>${message}</p><a href="/google.html">Voltar ao teste restrito</a></body></html>`,
    );
  };
  async function handler(req, res) {
    const url = new URL(req.url, origin),
      path = url.pathname;
    if (!path.startsWith("/oauth/google/") && !path.startsWith("/api/google/"))
      return false;
    if (req.headers["x-vibe-user-id"] !== ownerId) {
      json(res, 403, {
        error: "Acesso restrito ao proprietário autenticado no VibeCode.",
      });
      return true;
    }
    res.setHeader("Referrer-Policy", "no-referrer");
    // Remove entradas expiradas; nenhuma URL, código ou token é registrado.
    for (const [id, item] of states)
      if (item.expires < clock()) states.delete(id);
    for (const [id, item] of sessions)
      if (item.expires < clock()) sessions.delete(id);
    if (path === "/api/google/status" && req.method === "GET") {
      let sid = cookies(req)["__Host-test-session"],
        session = sessions.get(sid);
      if (!session) {
        sid = random();
        session = { csrf: random(), expires: clock() + 15 * 60_000 };
        sessions.set(sid, session);
        cookie(res, "__Host-test-session", sid, 900);
      }
      session.expires = clock() + 15 * 60_000;
      const account = loadAccount(),
        attempt = db.prepare("SELECT status FROM attempts WHERE id=1").get();
      json(res, 200, {
        configured,
        connected: Boolean(account),
        sender: SENDER,
        recipientSelectable: true,
        enabled,
        used: Boolean(attempt),
        attemptStatus: attempt?.status || null,
        csrf: session.csrf,
      });
      return true;
    }
    if (path === "/oauth/google/start" && req.method === "GET") {
      if (!configured) {
        html(res, 503, "Credenciais Google ainda não configuradas no backend.");
        return true;
      }
      if (states.size >= 100) {
        html(res, 429, "Muitas tentativas de conexão. Aguarde alguns minutos.");
        return true;
      }
      const state = random(),
        binding = random(),
        verifier = random(),
        nonce = random();
      states.set(state, {
        binding: hash(binding),
        verifier,
        nonce,
        expires: clock() + 10 * 60_000,
      });
      cookie(res, "__Host-google-state", binding, 600);
      const location = oauth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent select_account",
        scope: ["openid", "email", scope],
        state,
        nonce,
        login_hint: SENDER,
        hd: SENDER.split("@")[1],
        redirect_uri: origin + CALLBACK,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      res.writeHead(302, {
        Location: location,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      res.end();
      return true;
    }
    if (path === CALLBACK && req.method === "GET") {
      const state = url.searchParams.get("state"),
        entry = states.get(state);
      states.delete(state);
      const binding = cookies(req)["__Host-google-state"];
      cookie(res, "__Host-google-state", "", 0);
      if (
        !entry ||
        !binding ||
        !equal(entry.binding, hash(binding)) ||
        entry.expires < clock()
      ) {
        html(
          res,
          400,
          "Conexão expirada ou inválida. Inicie novamente pelo aplicativo.",
        );
        return true;
      }
      if (url.searchParams.has("error")) {
        html(res, 400, "A autorização Google foi cancelada ou recusada.");
        return true;
      }
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096) {
        html(res, 400, "Código de autorização inválido.");
        return true;
      }
      try {
        const { tokens } = await oauth.getToken({
          code,
          codeVerifier: entry.verifier,
          redirect_uri: origin + CALLBACK,
        });
        const ticket = await oauth.verifyIdToken({
          idToken: tokens.id_token,
          audience: clientId,
        });
        const identity = ticket.getPayload();
        if (
          identity.email?.toLowerCase() !== SENDER ||
          identity.email_verified !== true ||
          identity.hd !== SENDER.split("@")[1] ||
          identity.nonce !== entry.nonce
        ) {
          html(
            res,
            403,
            "Conta não autorizada. Conecte somente a conta remetente configurada.",
          );
          return true;
        }
        if (
          !tokens.refresh_token ||
          !tokens.scope?.split(" ").includes(scope)
        ) {
          html(
            res,
            400,
            "Permissão de envio ou autorização offline ausente. Refaça o consentimento.",
          );
          return true;
        }
        db.prepare(
          "INSERT INTO account(id,encrypted) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted",
        ).run(encrypt({ sender: SENDER, tokens }));
        res.writeHead(303, {
          Location: "/google.html?connected=1",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        res.end();
      } catch {
        html(
          res,
          502,
          "Não foi possível concluir a conexão Google. Confira a URL de retorno e as permissões no Google Cloud.",
        );
      }
      return true;
    }
    if (path === "/api/google/send-test" && req.method === "POST") {
      const session = sessions.get(cookies(req)["__Host-test-session"]);
      if (
        req.headers.origin !== origin ||
        !session ||
        !equal(session.csrf, req.headers["x-test-csrf"]) ||
        req.headers["sec-fetch-site"] === "cross-site"
      ) {
        json(res, 403, {
          error: "Requisição não autorizada. Reabra a página de teste.",
        });
        return true;
      }
      if (!enabled) {
        json(res, 403, { error: "Teste real desabilitado no backend." });
        return true;
      }
      // Aceita apenas um destinatário simples e confirmação explícita; nenhum header ou conteúdo livre.
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
        json(res, 400, { error: "Informe um destinatário em JSON." });
        return true;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) {
          json(res, 413, { error: "Requisição acima do limite." });
          return true;
        }
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        json(res, 400, { error: "Requisição inválida." });
        return true;
      }
      if (
        !input ||
        Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "confirmed,recipient" ||
        input.confirmed !== true ||
        typeof input.recipient !== "string"
      ) {
        json(res, 400, {
          error:
            "Confirme um único destinatário, sem cópias, remetente ou conteúdo adicional.",
        });
        return true;
      }
      const RECIPIENT = input.recipient.trim().toLowerCase();
      if (!validEmail(RECIPIENT)) {
        json(res, 400, {
          error: "Informe apenas um endereço de e-mail válido.",
        });
        return true;
      }
      const tokens = loadAccount();
      if (!tokens) {
        json(res, 409, { error: "Conecte primeiro a conta remetente." });
        return true;
      }
      // Reserva durável ANTES da chamada externa: nenhum retry automático, mesmo em timeout.
      try {
        db.prepare(
          "INSERT INTO attempts(id,status,createdAt,recipient) VALUES (1,'reserved',?,?)",
        ).run(new Date(clock()).toISOString(), RECIPIENT);
      } catch {
        json(res, 409, {
          error:
            "O único teste já foi solicitado. Não haverá reenvio automático.",
        });
        return true;
      }
      try {
        oauth.setCredentials(tokens);
        const raw = Buffer.from(
          `From: ${SENDER}\r\nTo: ${RECIPIENT}\r\nSubject: Teste restrito - Envio de e-mails\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nEste é o único e-mail de teste autorizado do aplicativo Envio de e-mails.\r\nCampanhas e disparos em massa permanecem desativados.\r\n`,
        ).toString("base64url");
        const result = await oauth.request({
          url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          method: "POST",
          data: { raw },
          timeout: 15000,
          retry: false,
          retryConfig: { retry: 0, noResponseRetries: 0 },
        });
        if (typeof result.data?.id !== "string")
          throw new Error("Sem confirmação");
        db.prepare(
          "UPDATE attempts SET status='accepted',messageId=? WHERE id=1",
        ).run(result.data.id);
        json(res, 200, {
          status: "accepted",
          message:
            "O Gmail aceitou o teste. Confirme o recebimento na caixa de entrada; isso não garante entrega.",
        });
      } catch {
        db.prepare("UPDATE attempts SET status='unknown' WHERE id=1").run();
        json(res, 502, {
          error:
            "Envio sem confirmação. Confira a caixa de entrada e os enviados. Por segurança, o teste não será repetido automaticamente.",
        });
      }
      return true;
    }
    json(res, 405, { error: "Operação não permitida." });
    return true;
  }
  function authorize(req, mutation = false) {
    if (!ownerId || req.headers["x-vibe-user-id"] !== ownerId) return false;
    if (!mutation) return true;
    const token = req.headers["x-test-csrf"];
    return (
      req.headers.origin === origin &&
      req.headers["sec-fetch-site"] !== "cross-site" &&
      Array.from(sessions.values()).some(
        (s) => s.expires >= clock() && equal(s.csrf, token),
      )
    );
  }
  async function sendCampaignMessage({ recipient, subject, body }) {
    if (
      !validEmail(recipient) ||
      typeof subject !== "string" ||
      !subject.trim() ||
      /[\r\n]/.test(subject) ||
      subject.length > 200 ||
      typeof body !== "string" ||
      !body.trim() ||
      body.length > 20000
    )
      throw new Error("Mensagem inválida.");
    const tokens = loadAccount();
    if (!tokens) throw new Error("Google desconectado.");
    oauth.setCredentials(tokens);
    const encodedSubject =
      "=?UTF-8?B?" + Buffer.from(subject).toString("base64") + "?=";
    const raw = Buffer.from(
      `From: ${SENDER}\r\nTo: ${recipient}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64")}\r\n`,
    ).toString("base64url");
    const result = await oauth.request({
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      method: "POST",
      data: { raw },
      timeout: 15000,
      retry: false,
      retryConfig: { retry: 0, noResponseRetries: 0 },
    });
    if (typeof result.data?.id !== "string")
      throw new Error("Sem confirmação.");
    return { messageId: result.data.id };
  }
  return {
    handler,
    authorize,
    sendCampaignMessage,
    connection: () => ({
      configured,
      connected: Boolean(loadAccount()),
      sender: SENDER,
    }),
    close: () => db.close(),
  };
}
