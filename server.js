import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openStore, AppError } from "./lib/store.js";
import { createCRM } from "./lib/crm.js";
const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/domain.js": ["domain.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
};
async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new AppError(415, "Utilize application/json.");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_500_000) throw new AppError(413, "Requisição muito grande.");
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError(400, "JSON inválido.");
  }
  if (!data || Array.isArray(data) || typeof data !== "object")
    throw new AppError(400, "Objeto JSON obrigatório.");
  return data;
}
export function createApp({
  store = openStore(process.env.DATABASE_PATH || resolve("data/app.sqlite")),
  crm = createCRM({
    enabled: process.env.CRM_ENABLED === "true",
    authorized: process.env.CRM_READ_AUTHORIZED === "true",
    key: process.env.VIBECODE_API_KEY,
  }),
} = {}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host || "";
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
        throw new AppError(
          403,
          "Host não autorizado. Use localhost ou 127.0.0.1.",
        );
      if (
        req.headers.origin &&
        ![`http://${host}`].includes(req.headers.origin)
      )
        throw new AppError(403, "Origem não autorizada.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new AppError(403, "Requisição externa bloqueada.");
      const url = new URL(req.url, "http://" + host),
        path = url.pathname;
      if (path === "/health" && req.method === "GET")
        return json(200, { ok: true, mode: "local-v2", sendingEnabled: false });
      if (path.startsWith("/api/")) {
        if (req.method !== "GET" && req.headers["x-local-request"] !== "1")
          throw new AppError(403, "Proteção local obrigatória.");
        if (path === "/api/state" && req.method === "GET")
          return json(200, store.state());
        const crmMatch = path.match(/^\/api\/crm\/(contacts|companies)$/);
        if (crmMatch) {
          if (req.method !== "GET")
            throw new AppError(403, "CRM permite apenas leitura.");
          return json(200, await crm.list(crmMatch[1], url.searchParams));
        }
        const recipients = path.match(
          /^\/api\/lists\/([a-zA-Z0-9-]+)\/recipients$/,
        );
        if (recipients) {
          if (req.method === "GET")
            return json(200, store.contacts(recipients[1]));
          if (req.method === "POST")
            return json(
              200,
              store.importRecipients(recipients[1], (await body(req)).contacts),
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
              id ? store.one(resource, id) : store.all(resource),
            );
          if (req.method === "POST" && !id)
            return json(201, store.save(resource, await body(req)));
          if (req.method === "PUT" && id)
            return json(200, store.save(resource, await body(req), id));
          if (req.method === "DELETE" && id) {
            store.remove(resource, id);
            return json(200, { deleted: true });
          }
          throw new AppError(405, "Método não permitido.");
        }
        throw new AppError(
          403,
          "Operação desativada. Não há endpoint de envio.",
        );
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new AppError(403, "Operação desativada.");
      const file = files[path];
      if (!file) throw new AppError(404, "Não encontrado.");
      const content = await readFile(
        fileURLToPath(new URL("./public/" + file[0], import.meta.url)),
      );
      res.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof AppError)
        return json(error.status, { error: error.message });
      if (String(error.code || "").startsWith("ERR_SQLITE"))
        return json(409, {
          error:
            "Conflito de dados: nome duplicado ou registro ainda referenciado.",
        });
      return json(500, {
        error: "Falha interna. Nenhum dado sensível foi registrado.",
      });
    }
  });
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, store } = createApp();
  server.listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
    console.log("Versão local iniciada. Envios reais bloqueados."),
  );
  const shutdown = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
