import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createGoogleTest } from "./lib/google-oauth.js";
import { openStore, AppError } from "./lib/store.js";
import { createDelivery } from "./lib/campaign-delivery.js";
const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/domain.js": ["domain.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
  "/google.html": ["google.html", "text/html"],
  "/google.js": ["google.js", "text/javascript"],
};
async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new AppError(415, "Utilize application/json.");
  let bytes = 0;
  const parts = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_500_000) throw new AppError(413, "Requisição muito grande.");
    parts.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new AppError(400, "JSON inválido.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new AppError(400, "Objeto JSON obrigatório.");
  return value;
}
export function createApplication({
  google,
  store,
  enabled = process.env.CAMPAIGN_SEND_ENABLED === "true",
  dataPath = process.env.DATABASE_PATH || resolve("data/app.sqlite"),
  autoStart = true,
  intervalMs = 2000,
} = {}) {
  let delivery;
  function initialize() {
    google ||= createGoogleTest();
    store ||= openStore(dataPath);
    if (!delivery) {
      delivery = createDelivery({ store, google, enabled, intervalMs });
      if (autoStart) delivery.start();
    }
    return { google, store, delivery };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/health" && req.method === "GET")
        return json(200, {
          ok: true,
          mode: "campaigns",
          sendingEnabled: enabled,
          restrictedTestEnabled: process.env.TEST_EMAIL_ENABLED === "true",
        });
      if (
        path.startsWith("/oauth/google/") ||
        path.startsWith("/api/google/")
      ) {
        google ||= createGoogleTest();
        return await google.handler(req, res);
      }
      if (path.startsWith("/api/")) {
        if (!google) {
          const owner = process.env.OAUTH_OWNER_USER_ID;
          if (!owner || req.headers["x-vibe-user-id"] !== owner)
            throw new AppError(403, "Acesso restrito ao proprietário.");
        }
        const ctx = initialize();
        if (!ctx.google.authorize(req, req.method !== "GET"))
          throw new AppError(
            403,
            "Reabra o aplicativo autenticado; origem ou sessão não autorizada.",
          );
        if (path === "/api/state" && req.method === "GET")
          return json(200, {
            ...ctx.store.state(),
            deliveries: ctx.delivery.list(),
            suppressionCount: ctx.delivery.suppressions().length,
          });
        if (path === "/api/delivery-status" && req.method === "GET")
          return json(200, {
            ...ctx.google.connection(),
            enabled,
            maxRecipients: 50,
            dailyLimit: 100,
          });
        if (path === "/api/suppressions") {
          if (req.method === "GET")
            return json(200, ctx.delivery.suppressions());
          if (req.method === "POST") {
            const input = await body(req);
            ctx.delivery.suppress(input.email, input.reason);
            return json(201, { saved: true });
          }
        }
        const send = path.match(
          /^\/api\/campaigns\/([a-zA-Z0-9-]+)\/(preview|send)$/,
        );
        if (send && req.method === "POST")
          return json(
            send[2] === "preview" ? 200 : 201,
            send[2] === "preview"
              ? ctx.delivery.preview(send[1], await body(req))
              : ctx.delivery.enqueue(send[1], await body(req)),
          );
        const job = path.match(
          /^\/api\/deliveries\/([a-zA-Z0-9-]+)(?:\/(cancel|resume))?$/,
        );
        if (job) {
          if (req.method === "GET" && !job[2])
            return json(200, ctx.delivery.get(job[1]));
          if (req.method === "POST" && job[2])
            return json(
              200,
              job[2] === "cancel"
                ? ctx.delivery.cancel(job[1])
                : ctx.delivery.resume(job[1]),
            );
        }
        const recipients = path.match(
          /^\/api\/lists\/([a-zA-Z0-9-]+)\/recipients$/,
        );
        if (recipients) {
          if (req.method === "GET")
            return json(200, ctx.store.contacts(recipients[1]));
          if (req.method === "POST")
            return json(
              200,
              ctx.store.importRecipients(
                recipients[1],
                (await body(req)).contacts,
              ),
            );
        }
        const match = path.match(
          /^\/api\/(campaigns|templates|lists)(?:\/([a-zA-Z0-9-]+))?$/,
        );
        if (match) {
          const [, resource, id] = match;
          if (req.method === "GET")
            return json(
              200,
              id ? ctx.store.one(resource, id) : ctx.store.all(resource),
            );
          if (req.method === "POST" && !id)
            return json(201, ctx.store.save(resource, await body(req)));
          if (req.method === "PUT" && id)
            return json(200, ctx.store.save(resource, await body(req), id));
          if (req.method === "DELETE" && id) {
            ctx.store.remove(resource, id);
            return json(200, { deleted: true });
          }
        }
        throw new AppError(403, "Operação não permitida.");
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new AppError(403, "Operação não permitida.");
      const file = files[path];
      if (!file) throw new AppError(404, "Não encontrado.");
      const content = await readFile(
        fileURLToPath(new URL("./public/" + file[0], import.meta.url)),
      );
      res.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof AppError) return json(e.status, { error: e.message });
      if (String(e.code || "").startsWith("ERR_SQLITE"))
        return json(409, { error: "Dados duplicados ou ainda referenciados." });
      return json(500, {
        error: "Operação indisponível; nenhum detalhe sensível foi registrado.",
      });
    }
  });
  return {
    server,
    initialize,
    close: async () => {
      await delivery?.stop();
      await new Promise((r) => server.close(r));
      store?.close();
      google?.close();
    },
  };
}
const application = createApplication();
export const server = application.server;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.CAMPAIGN_SEND_ENABLED === "true") application.initialize();
  server.listen(Number(process.env.PORT || 3000), "0.0.0.0");
  const shutdown = () => application.close().then(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
