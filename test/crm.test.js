import { test } from "node:test";
import assert from "node:assert/strict";
import { createCRM } from "../lib/crm.js";
test("CRM requer configuração e autorização explícitas antes de qualquer conexão", async () => {
  let calls = 0;
  for (const config of [
    {},
    { enabled: true, key: "dummy" },
    { authorized: true, key: "dummy" },
    { enabled: true, authorized: true },
  ]) {
    const crm = createCRM({
      ...config,
      fetchImpl: async () => {
        calls++;
      },
    });
    await assert.rejects(
      crm.list("contacts", new URLSearchParams()),
      /desativado/,
    );
  }
  assert.equal(calls, 0);
});
test("consultas simuladas somente GET, filtros oficiais, paginação e projeção segura", async () => {
  const requests = [];
  const crm = createCRM({
    enabled: true,
    authorized: true,
    key: "dummy-test-secret",
    fetchImpl: async (url, opts) => {
      requests.push({ url, opts });
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 1,
              name: "Ana",
              title: "Empresa",
              email: [{ value: "ana@example.com" }],
              secret: "dummy-test-secret",
            },
          ],
        }),
      };
    },
  });
  const result = await crm.list(
    "contacts",
    new URLSearchParams({
      name: "Ana",
      email: "ana@example.com",
      responsible: "75",
      limit: "1",
      offset: "2",
    }),
  );
  assert.deepEqual(JSON.parse(requests[0].url.searchParams.get("filter")), {
    name: { $contains: "Ana" },
    email: "ana@example.com",
    assignedById: 75,
  });
  assert.equal(requests[0].opts.method, "GET");
  assert.equal(requests[0].opts.headers["X-Api-Key"], "dummy-test-secret");
  assert.equal(requests[0].opts.redirect, "error");
  assert.equal(result.meta.nextOffset, 3);
  assert.ok(!JSON.stringify(result).includes("dummy-test-secret"));
  await crm.list("companies", new URLSearchParams({ name: "Empresa" }));
  assert.deepEqual(JSON.parse(requests[1].url.searchParams.get("filter")), {
    title: { $contains: "Empresa" },
  });
  for (const params of [
    { limit: "51" },
    { offset: "-1" },
    { responsible: "abc" },
    { token: "anything" },
  ])
    await assert.rejects(crm.list("contacts", new URLSearchParams(params)));
  assert.equal(requests.length, 2);
});
test("falhas, redirecionamentos e corpos inesperados não expõem credenciais", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("dummy-test-secret");
    },
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => ({ success: true, data: null }),
    }),
  ]) {
    const crm = createCRM({
      enabled: true,
      authorized: true,
      key: "dummy-test-secret",
      fetchImpl,
    });
    await assert.rejects(
      crm.list("contacts", new URLSearchParams()),
      (e) => e.status === 502 && !e.message.includes("dummy-test-secret"),
    );
  }
});
