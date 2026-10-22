import { parseCSV } from "./domain.js";
const state = { campaigns: [], templates: [], lists: [], contacts: [] },
  view = document.querySelector("#view");
let selectedList = "demo-list",
  allContacts = [];
async function api(path, method = "GET", data) {
  const response = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Local-Request": "1" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Falha na operação.");
  return result;
}
async function refresh() {
  const loaded = await api("state");
  Object.assign(state, loaded);
  allContacts = loaded.contacts;
  if (!state.lists.some((l) => l.id === selectedList))
    selectedList = state.lists[0]?.id;
  state.contacts = allContacts.filter((c) => c.listId === selectedList);
}
async function action(fn) {
  try {
    await fn();
  } catch (e) {
    tell(e.message);
  }
}
const pages = {
  dashboard: "Dashboard",
  campaigns: "Campanhas",
  contacts: "Contatos",
  templates: "Modelos de e-mail",
  reports: "Relatórios",
  crm: "CRM · somente leitura",
};
const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => n.toLocaleString("pt-BR");
const tell = (text) => (document.querySelector("#message").textContent = text);
const table = (headers, rows) =>
  `<table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
function campaigns() {
  return table(
    ["Campanha", "Assunto", "Público", "Estado", "Ações"],
    state.campaigns.map(
      (c) =>
        `<tr><td><strong>${escape(c.name)}</strong></td><td>${escape(c.subject)}</td><td>${fmt(c.audience)}</td><td><span class="badge">${escape(c.status)}</span></td><td>${c.status === "Rascunho" ? `<button class="secondary" data-edit="${escape(c.id)}">Editar</button><button class="secondary" data-delete="${escape(c.id)}">Excluir</button>` : ""}<button disabled title="Nenhum provedor conectado">Enviar</button></td></tr>`,
    ),
  );
}
function title(name, description, action = "") {
  return `<div class="title"><div><h1>${name}</h1><p>${description}</p></div>${action}</div>`;
}
function campaignForm(id) {
  const requestId = crypto.randomUUID();
  const c = state.campaigns.find((c) => c.id === id);
  view.innerHTML =
    title(
      c ? "Editar campanha" : "Nova campanha",
      "Salve um rascunho demonstrativo. Nenhum envio será realizado.",
    ) +
    `<div class="panel"><form id="campaign-form"><label>Nome da campanha<input name="name" required maxlength="120" value="${escape(c?.name || "")}"></label><label>Assunto<input name="subject" required maxlength="200" value="${escape(c?.subject || "")}"></label><label>Modelo<select name="template">${state.templates.map((t) => `<option value="${t.id}" ${c?.template === t.id ? "selected" : ""}>${escape(t.name)}</option>`).join("")}</select></label><label>Lista de destinatários<select name="listId">${state.lists.map((l) => `<option value="${l.id}" ${(c?.listId || selectedList) === l.id ? "selected" : ""}>${escape(l.name)}</option>`).join("")}</select></label><p>Público atual da lista selecionada no painel: ${state.contacts.length} contatos da lista selecionada. Consentimento não validado.</p><button>Salvar rascunho</button> <a href="#campaigns">Cancelar</a></form></div>`;
  document.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const data = new FormData(e.target);
      await api("campaigns" + (c ? "/" + c.id : ""), c ? "PUT" : "POST", {
        id: c?.id || requestId,
        version: c?.version,
        name: data.get("name"),
        subject: data.get("subject"),
        template: data.get("template"),
        listId: data.get("listId"),
      });
      await refresh();
      location.hash = "campaigns";
      render();
      tell("Rascunho salvo no SQLite.");
    });
  };
}

function render() {
  const page = location.hash.slice(1) || "dashboard",
    current = pages[page] ? page : "dashboard";
  tell("");
  document.querySelector("nav").innerHTML = Object.entries(pages)
    .map(
      ([key, label]) =>
        `<a href="#${key}" class="${current === key ? "active" : ""}" ${current === key ? 'aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  document.querySelector("#breadcrumb").textContent = pages[current];
  if (current === "dashboard") {
    view.innerHTML =
      title(
        "Visão geral",
        "Acompanhe suas campanhas e prepare as próximas conversas.",
        '<button id="new">+ Nova campanha</button>',
      ) +
      `<div class="cards">${[
        ["Campanhas", state.campaigns.length, "Rascunhos e simulações"],
        ["Contatos", state.contacts.length, "Lista selecionada"],
        ["Entregas simuladas", 1218, "Nenhum e-mail real enviado"],
        ["Aberturas simuladas", "38%", "463 aberturas fictícias"],
      ]
        .map(
          ([label, num, note]) =>
            `<article class="card"><small>${label}</small><strong>${typeof num === "number" ? fmt(num) : num}</strong><span>${note}</span></article>`,
        )
        .join(
          "",
        )}</div><div class="grid"><article class="panel"><h2>Desempenho demonstrativo</h2><p>Boas-vindas à nossa comunidade</p>Entrega · 97,4%<div class="bar"><i class="rate-delivered"></i></div>Abertura · 38,0%<div class="bar"><i class="rate-open"></i></div>Cliques · 11,0%<div class="bar"><i class="rate-click"></i></div></article><article class="panel"><h2>Prepare sua primeira campanha</h2><p>1. Importe e revise seus contatos.<br>2. Escolha um modelo e crie um rascunho.<br>3. Revise o conteúdo da campanha.</p><span class="badge">Provedor de envio desconectado</span><p>CRM, agendamento e filas serão integrados nas próximas versões.</p></article></div><article class="panel"><h2>Campanhas recentes</h2>${campaigns()}</article>`;
  }
  if (current === "campaigns")
    view.innerHTML =
      title(
        "Campanhas",
        "Organize seus rascunhos e campanhas demonstrativas.",
        '<button id="new">+ Nova campanha</button>',
      ) + `<article class="panel">${campaigns()}</article>`;
  if (current === "contacts") {
    view.innerHTML =
      title("Contatos", "Importe um CSV para testar a preparação do público.") +
      `<article class="panel"><label>Lista<select id="list">${state.lists.map((l) => `<option value="${l.id}" ${l.id === selectedList ? "selected" : ""}>${escape(l.name)}</option>`).join("")}</select></label><button id="new-list" class="secondary">Nova lista</button><label>Arquivo CSV (máximo 2 MB)<input id="csv" type="file" accept=".csv,text/csv"></label><p>Coluna obrigatória: email. Opcionais: nome, empresa. Separador vírgula ou ponto e vírgula. Dados importados são salvos no banco SQLite local.</p><button id="sample" class="secondary">Baixar CSV de exemplo</button><p id="import-result" role="status"></p></article><article class="panel">${table(
        ["Nome", "E-mail", "Empresa", "Consentimento"],
        state.contacts.map(
          (c) =>
            `<tr>${[c.nome, c.email, c.empresa, c.consentimento].map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`,
        ),
      )}</article>`;
    document.querySelector("#list").onchange = (e) => {
      selectedList = e.target.value;
      state.contacts = allContacts.filter((c) => c.listId === selectedList);
      render();
    };
    document.querySelector("#new-list").onclick = () => {
      const name = prompt("Nome da nova lista:");
      if (name)
        action(async () => {
          const list = await api("lists", "POST", { name });
          selectedList = list.id;
          await refresh();
          render();
        });
    };
    document.querySelector("#sample").onclick = () =>
      download(
        "contatos-exemplo.csv",
        "nome,email,empresa\nAna Demo,ana@example.com,Empresa Exemplo\n",
      );
    document.querySelector("#csv").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (file.size > 2_000_000) throw new Error("CSV excede 2 MB.");
        const result = parseCSV(await file.text());
        const imported = await api(
          "lists/" + selectedList + "/recipients",
          "POST",
          { contacts: result.contacts },
        );
        await refresh();
        render();
        document.querySelector("#import-result").textContent =
          `${imported.added} contatos importados; ${result.invalid} linhas inválidas; ${result.duplicates + imported.duplicates} duplicados ignorados.`;
      } catch (error) {
        tell(error.message);
      }
    };
  }
  if (current === "templates") {
    view.innerHTML =
      title(
        "Modelos de e-mail",
        "Edite conteúdo textual e visualize sem executar HTML.",
      ) +
      `<article class="panel"><label>Modelo<select id="template">${state.templates.map((t) => `<option value="${t.id}">${escape(t.name)}</option>`).join("")}</select></label><div id="editor"></div></article>`;
    const edit = () => {
      const t = state.templates.find(
        (t) => t.id === document.querySelector("#template").value,
      );
      document.querySelector("#editor").innerHTML =
        `<form><label>Assunto<input name="subject" required maxlength="200" value="${escape(t.subject)}"></label><label>Conteúdo<textarea name="body" required maxlength="20000">${escape(t.body)}</textarea></label><button>Salvar modelo</button></form><h2>Prévia demonstrativa</h2><pre id="preview"></pre>`;
      const form = document.querySelector("form"),
        preview = () =>
          (document.querySelector("#preview").textContent =
            form.elements.body.value.replaceAll("{{nome}}", "Ana Demo"));
      form.oninput = preview;
      form.onsubmit = (e) => {
        e.preventDefault();
        action(async () => {
          const updated = await api("templates/" + t.id, "PUT", {
            name: t.name,
            subject: form.elements.subject.value,
            body: form.elements.body.value,
            version: t.version,
          });
          Object.assign(t, updated);
          tell("Modelo salvo no SQLite.");
        });
      };
      preview();
    };
    document.querySelector("#template").onchange = edit;
    edit();
  }
  if (current === "reports") {
    view.innerHTML =
      title(
        "Relatórios",
        "Resultados inteiramente fictícios para validação da interface.",
        '<button id="export">Exportar relatório CSV</button>',
      ) +
      `<article class="panel">${table(
        [
          "Campanha",
          "Entregas simuladas",
          "Aberturas simuladas",
          "Cliques simulados",
        ],
        state.campaigns.map(
          (c) =>
            `<tr><td>${escape(c.name)}</td><td>${fmt(c.delivered)}</td><td>${fmt(c.opened)}</td><td>${fmt(c.clicked)}</td></tr>`,
        ),
      )}</article><p>Esses números não medem desempenho real. A infraestrutura para mais de 300 mil e-mails/mês ainda não foi implementada ou validada.</p>`;
    document.querySelector("#export").onclick = () =>
      download(
        "relatorio-demonstrativo.csv",
        "campanha,entregas_simuladas,aberturas_simuladas,cliques_simulados\n" +
          state.campaigns
            .map((c) =>
              [c.name, c.delivered, c.opened, c.clicked].map(csvCell).join(","),
            )
            .join("\n"),
      );
  }
  if (current === "crm") {
    view.innerHTML =
      title(
        "CRM Bitrix24",
        "Desativado por padrão. A conexão exige configuração e autorização no backend.",
      ) +
      `<article class="panel"><form id="crm-search"><label>Consultar<select name="entity"><option value="contacts">Contatos</option><option value="companies">Empresas</option></select></label><label>Nome<input name="name" maxlength="200"></label><label>E-mail exato<input name="email" type="email"></label><label>ID do responsável<input name="responsible" inputmode="numeric" pattern="[0-9]*"></label><button>Consultar CRM</button></form><p id="crm-result" role="status"></p><div id="crm-data"></div><button id="crm-next" disabled>Próxima página</button></article>`;
    let offset = 0,
      next = null;
    const form = document.querySelector("#crm-search");
    async function load() {
      const values = new FormData(form),
        query = new URLSearchParams({ limit: "25", offset: String(offset) });
      for (const field of ["name", "email", "responsible"])
        if (values.get(field)) query.set(field, values.get(field));
      const r = await api("crm/" + values.get("entity") + "?" + query);
      document.querySelector("#crm-result").textContent =
        `${r.data.length} resultados nesta página. Sem importação automática.`;
      document.querySelector("#crm-data").innerHTML = table(
        ["ID", "Nome", "E-mail", "Responsável"],
        r.data.map(
          (row) =>
            `<tr>${[row.id, row.name, Array.isArray(row.email) ? row.email.map((e) => e.value).join(", ") : row.email, row.assignedById].map((value) => `<td>${escape(value ?? "")}</td>`).join("")}</tr>`,
        ),
      );
      next = r.meta.nextOffset;
      document.querySelector("#crm-next").disabled = next === null;
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      offset = 0;
      action(load);
    };
    document.querySelector("#crm-next").onclick = () => {
      offset = next;
      action(load);
    };
  }
  document
    .querySelector("#new")
    ?.addEventListener("click", () => campaignForm());
  document
    .querySelectorAll("[data-edit]")
    .forEach((b) => (b.onclick = () => campaignForm(b.dataset.edit)));
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () => {
        if (confirm("Excluir este rascunho?"))
          action(async () => {
            await api("campaigns/" + b.dataset.delete, "DELETE");
            await refresh();
            render();
            tell("Rascunho excluído.");
          });
      }),
  );
}
function csvCell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function download(name, text) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
window.addEventListener("hashchange", render);
await action(async () => {
  await refresh();
  render();
});
