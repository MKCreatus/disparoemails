import { AppError } from "./store.js";
export function createCRM({
  enabled = false,
  authorized = false,
  key,
  fetchImpl = fetch,
} = {}) {
  return {
    async list(entity, params) {
      if (!enabled || !authorized || !key)
        throw new AppError(
          403,
          "CRM desativado. Configure e autorize explicitamente no backend.",
        );
      if (!["contacts", "companies"].includes(entity))
        throw new AppError(404, "Entidade não permitida.");
      for (const name of params.keys())
        if (!["name", "email", "responsible", "limit", "offset"].includes(name))
          throw new AppError(400, "Filtro não permitido.");
      const number = (name, def, max) => {
        const v = params.get(name) ?? String(def);
        if (
          !/^\d+$/.test(v) ||
          Number(v) > max ||
          (name === "limit" && Number(v) < 1)
        )
          throw new AppError(400, "Paginação inválida.");
        return Number(v);
      };
      const limit = number("limit", 25, 50),
        offset = number("offset", 0, 1000000),
        filter = {};
      const name = params.get("name"),
        email = params.get("email"),
        responsible = params.get("responsible");
      if (name) {
        if (name.length > 200) throw new AppError(400, "Nome muito longo.");
        filter[entity === "contacts" ? "name" : "title"] = { $contains: name };
      }
      if (email) {
        if (email.length > 254) throw new AppError(400, "E-mail muito longo.");
        filter.email = email;
      }
      if (responsible) {
        if (!/^\d+$/.test(responsible))
          throw new AppError(400, "Responsável inválido.");
        filter.assignedById = Number(responsible);
      }
      const url = new URL("https://vibecode.bitrix24.com/v1/" + entity);
      url.search = new URLSearchParams({
        filter: JSON.stringify(filter),
        limit: String(limit),
        offset: String(offset),
        withTotal: "false",
        select:
          entity === "contacts"
            ? "id,name,lastName,email,companyId,assignedById"
            : "id,title,email,assignedById",
        sort: "id",
      });
      let response, payload;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { "X-Api-Key": key, Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error();
        payload = await response.json();
        if (payload.success !== true || !Array.isArray(payload.data))
          throw new Error();
      } catch {
        throw new AppError(
          502,
          "Consulta CRM falhou. Nenhum detalhe de autenticação foi exposto.",
        );
      }
      // Projeta somente campos conhecidos; nunca devolve corpo/headers brutos do serviço.
      const scalar = (v) =>
        typeof v === "string"
          ? v.replaceAll(key, "[redigido]").slice(0, 500)
          : typeof v === "number"
            ? v
            : null;
      const data = payload.data.map((row) => ({
        id: scalar(row.id),
        name: scalar(entity === "contacts" ? row.name : row.title),
        lastName: scalar(row.lastName),
        assignedById: scalar(row.assignedById),
        email: Array.isArray(row.email)
          ? row.email.map((e) => ({ value: scalar(e.value) }))
          : scalar(row.email),
      }));
      return {
        data,
        meta: {
          limit,
          offset,
          nextOffset: payload.data.length === limit ? offset + limit : null,
        },
      };
    },
  };
}
