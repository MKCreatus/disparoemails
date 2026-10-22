import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.js";
import { openStore } from "../lib/store.js";
const dir = mkdtempSync(join(tmpdir(), "emails-ui-"));
let app, browser;
async function start() {
  app = createApp({ store: openStore(join(dir, "test.sqlite")) });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${app.server.address().port}`;
}
async function stop() {
  if (app) {
    await new Promise((r) => app.server.close(r));
    app.store.close();
    app = null;
  }
}
try {
  let base = await start();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Visão geral" }).waitFor();
  await page.getByRole("button", { name: "+ Nova campanha" }).click();
  await page.getByLabel("Nome da campanha").fill("Rascunho navegador");
  await page.getByLabel("Assunto", { exact: true }).fill("Assunto persistente");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.getByText("Rascunho navegador", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Rascunho navegador", { exact: true }).waitFor();
  const row = page.getByRole("row").filter({ hasText: "Rascunho navegador" });
  await row.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Assunto", { exact: true }).fill("Assunto editado");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.getByText("Assunto editado", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Modelos de e-mail" }).click();
  await page.getByLabel("Conteúdo").fill("Modelo persistente {{nome}}");
  await page.getByRole("button", { name: "Salvar modelo" }).click();
  await page.getByText("Modelo salvo no SQLite.").waitFor();
  await page.reload();
  await page
    .getByText("Modelo persistente Ana Demo", { exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Contatos", exact: true }).click();
  page.once("dialog", (d) => d.accept("Lista navegador"));
  await page.getByRole("button", { name: "Nova lista" }).click();
  await page
    .locator("#list")
    .selectOption({ label: "Lista navegador" });
  await page
    .getByLabel("Arquivo CSV")
    .setInputFiles({
      name: "exemplo.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "nome,email,empresa\nPessoa Teste,teste@example.com,Demo\nPessoa Teste,TESTE@example.com,Demo\n",
      ),
    });
  await page
    .getByText(
      "1 contatos importados; 0 linhas inválidas; 1 duplicados ignorados.",
    )
    .waitFor();
  await page.reload();
  await page
    .locator("#list")
    .selectOption({ label: "Lista navegador" });
  await page.getByText("teste@example.com", { exact: true }).waitFor();
  await page.getByRole("link", { name: "CRM · somente leitura" }).click();
  await page.getByRole("button", { name: "Consultar CRM" }).click();
  await page
    .getByText(
      "CRM desativado. Configure e autorize explicitamente no backend.",
    )
    .waitFor();
  // Reabre servidor e conexão SQLite para verificar durabilidade além da recarga.
  await page.goto("about:blank");
  await stop();
  base = await start();
  await page.goto(base + "/#campaigns");
  await page.getByText("Rascunho navegador", { exact: true }).waitFor();
  const saved = page.getByRole("row").filter({ hasText: "Rascunho navegador" });
  assert.equal(
    await saved
      .getByRole("button", { name: "Enviar", exact: true })
      .isDisabled(),
    true,
  );
  page.once("dialog", (d) => d.accept());
  await saved.getByRole("button", { name: "Excluir" }).click();
  await page.getByText("Rascunho excluído.").waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Campanhas", exact: true }).waitFor();
  assert.equal(
    await page.getByText("Rascunho navegador", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Interface validada em Chromium: CRUD, recarga, reinício, modelos, CSV, listas, CRM desligado e envios bloqueados.",
  );
} finally {
  await browser?.close();
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
