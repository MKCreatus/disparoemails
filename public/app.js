import { parseCSV } from "./domain.js";
const state = {
    campaigns: [],
    templates: [],
    lists: [],
    contacts: [],
    deliveries: [],
  },
  view = document.querySelector("#view");
let selectedList = "demo-list",
  allContacts = [];
let csrf = "",
  csrfAt = 0;
async function api(path, method = "GET", data) {
  if (method !== "GET" && (!csrf || Date.now() - csrfAt > 600000)) {
    const r = await fetch("/api/google/status");
    const auth = await r.json();
    if (!r.ok) throw new Error(auth.error || "Autenticação indisponível.");
    csrf = auth.csrf;
    csrfAt = Date.now();
  }

  const response = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-CSRF": csrf },
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
  google: "Google Workspace",
  deliveries: "Envios",
  suppressions: "Supressões",
};
const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const jobLabels = {
  queued: "Na fila",
  running: "Em processamento",
  paused: "Pausado",
  needs_review: "Revisão necessária",
  completed: "Concluído",
  cancelled: "Cancelado",
};
const fmt = (n) => n.toLocaleString("pt-BR");
const tell = (text) => (document.querySelector("#message").textContent = text);
const table = (headers, rows) =>
  `<table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
function campaigns() {
  return table(
    ["Campanha", "Assunto", "Público", "Estado", "Ações"],
    state.campaigns.map((c) => {
      const job = state.deliveries.find((d) => d.campaignId === c.id);
      return `<tr><td><strong>${escape(c.name)}</strong></td><td>${escape(c.subject)}</td><td>${fmt(c.audience)}</td><td><span class="badge">${escape(job ? jobLabels[job.status] || job.status : c.status)}</span></td><td>${c.status === "Rascunho" && !job ? `<button class="secondary" data-edit="${c.id}">Editar</button><button class="secondary" data-delete="${c.id}">Excluir</button><button data-send="${c.id}">Revisar e enviar</button>` : job ? `<a href="#deliveries">Ver envio</a>` : "Dados simulados"}</td></tr>`;
    }),
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
      tell("Rascunho salvo.");
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
        ["Campanhas", state.campaigns.length, "Campanhas e simulações"],
        ["Contatos", state.contacts.length, "Lista selecionada"],
        [
          "Aceitos pelo Gmail",
          state.deliveries
            .flatMap((d) => d.items)
            .filter((i) => i.status === "accepted").length,
          "Aceitação não garante entrega",
        ],
        [
          "Pendentes",
          state.deliveries
            .flatMap((d) => d.items)
            .filter((i) => i.status === "pending").length,
          "Acompanhe na aba Envios",
        ],
      ]
        .map(
          ([label, num, note]) =>
            `<article class="card"><small>${label}</small><strong>${typeof num === "number" ? fmt(num) : num}</strong><span>${note}</span></article>`,
        )
        .join(
          "",
        )}</div><div class="grid"><article class="panel"><h2>Exemplo de métricas (simulado)</h2><p>Boas-vindas à nossa comunidade</p>Entrega · 97,4%<div class="bar"><i class="rate-delivered"></i></div>Abertura · 38,0%<div class="bar"><i class="rate-open"></i></div>Cliques · 11,0%<div class="bar"><i class="rate-click"></i></div></article><article class="panel"><h2>Prepare sua primeira campanha</h2><p>1. Importe e revise seus contatos.<br>2. Escolha um modelo e crie um rascunho.<br>3. Revise o conteúdo da campanha.</p><span class="badge">Google Workspace · consulte a conexão</span><p>Conecte o Google Workspace e revise uma campanha antes de enviar.</p></article></div><article class="panel"><h2>Campanhas recentes</h2>${campaigns()}</article>`;
  }
  if (current === "campaigns")
    view.innerHTML =
      title(
        "Campanhas",
        "Crie rascunhos, escolha o modelo e revise o envio.",
        '<button id="new">+ Nova campanha</button>',
      ) + `<article class="panel">${campaigns()}</article>`;
  if (current === "contacts") {
    view.innerHTML =
      title("Contatos", "Importe um CSV para testar a preparação do público.") +
      `<article class="panel"><label>Lista<select id="list">${state.lists.map((l) => `<option value="${l.id}" ${l.id === selectedList ? "selected" : ""}>${escape(l.name)}</option>`).join("")}</select></label><button id="new-list" class="secondary">Nova lista</button><label>Arquivo CSV (máximo 2 MB)<input id="csv" type="file" accept=".csv,text/csv"></label><p>Coluna obrigatória: email. Opcionais: nome, empresa. Separador vírgula ou ponto e vírgula. As listas importadas ficam salvas no aplicativo.</p><button id="sample" class="secondary">Baixar CSV de exemplo</button><p id="import-result" role="status"></p></article><article class="panel">${table(
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
          tell("Modelo salvo.");
        });
      };
      preview();
    };
    document.querySelector("#template").onchange = edit;
    edit();
  }
  if (current === "reports") {
    const rows = state.deliveries.flatMap((d) =>
      d.items.map((i) => ({
        campaign:
          state.campaigns.find((c) => c.id === d.campaignId)?.name ||
          "Campanha",
        email: i.email,
        status: i.status,
        time: new Date(d.createdAt).toLocaleString("pt-BR"),
      })),
    );
    view.innerHTML =
      title(
        "Relatórios",
        "Resultados reais de processamento. O Gmail aceitar uma mensagem não confirma entrega ou abertura.",
        '<button id="export">Exportar CSV</button>',
      ) +
      `<article class="panel">${table(
        ["Campanha", "Destinatário", "Resultado", "Criado em"],
        rows.map(
          (r) =>
            `<tr>${[r.campaign, r.email, { accepted: "Aceito pelo Gmail", pending: "Pendente", sending: "Em processamento", unknown: "Sem confirmação", cancelled: "Cancelado", suppressed: "Suprimido" }[r.status] || r.status, r.time].map((x) => `<td>${escape(x)}</td>`).join("")}</tr>`,
        ),
      )}</article>`;
    document.querySelector("#export").onclick = () =>
      download(
        "relatorio-envios.csv",
        "campanha,destinatario,resultado,criado_em\n" +
          rows
            .map((r) =>
              [r.campaign, r.email, r.status, r.time].map(csvCell).join(","),
            )
            .join("\n"),
      );
  }
  if (current === "google") {
    view.innerHTML =
      title(
        "Google Workspace",
        "Conecte a conta remetente para enviar suas campanhas.",
      ) +
      `<article class="panel"><p id="connection">Consultando conexão…</p><a class="button" href="/oauth/google/start" target="_blank" rel="noopener noreferrer">Conectar ou reconectar Google Workspace</a><button id="check-google" class="secondary">Atualizar conexão</button><p>A autorização Google abre em outra aba. Ao concluir, retorne aqui e atualize a conexão. Nenhum e-mail é enviado ao conectar.</p><p>Envio manual para um destinatário ou uma lista. Limites iniciais: 50 por envio e 100 em 24 horas. Os limites da sua conta Google também se aplicam.</p></article>`;
    const check = () =>
      action(async () => {
        const c = await api("delivery-status");
        document.querySelector("#connection").textContent = c.configured
          ? c.connected
            ? `Conectado como ${c.sender}. ${c.enabled ? "Envio manual disponível." : "Envios desativados no backend."}`
            : `Conta ${c.sender} ainda não conectada.`
          : "Configure as credenciais no backend.";
      });
    document.querySelector("#check-google").onclick = check;
    check();
  }
  if (current === "deliveries") {
    const labels = {
      pending: "Pendente",
      sending: "Em processamento",
      accepted: "Aceito pelo Gmail",
      unknown: "Sem confirmação",
      suppressed: "Suprimido",
      cancelled: "Cancelado",
    };
    view.innerHTML =
      title(
        "Envios",
        "Aceitação pelo Gmail não garante entrega ou leitura. Resultados desconhecidos nunca são reenviados automaticamente.",
        '<button id="refresh-jobs">Atualizar</button>',
      ) +
      (state.deliveries.length
        ? state.deliveries
            .map(
              (job) =>
                `<article class="panel"><h2>${escape(state.campaigns.find((c) => c.id === job.campaignId)?.name || "Campanha")}</h2><p>Estado: ${escape(jobLabels[job.status] || job.status)} · ${job.items.filter((i) => i.status === "accepted").length} aceitos de ${job.items.length}</p>${table(
                  ["Destinatário", "Resultado"],
                  job.items.map(
                    (i) =>
                      `<tr><td>${escape(i.email)}</td><td>${escape(labels[i.status] || i.status)}${i.error ? `<p>${escape(i.error)}</p>` : ""}</td></tr>`,
                  ),
                )}${job.items.some((i) => i.status === "pending") ? `<button class="secondary" data-cancel="${job.id}">Cancelar pendentes</button>` : ""}${job.status === "paused" ? `<button data-resume="${job.id}">Continuar somente pendentes</button>` : ""}</article>`,
            )
            .join("")
        : "<p>Nenhum envio registrado.</p>");
    document.querySelector("#refresh-jobs").onclick = () =>
      action(async () => {
        await refresh();
        render();
      });
    document.querySelectorAll("[data-cancel]").forEach(
      (b) =>
        (b.onclick = () => {
          if (confirm("Cancelar os destinatários ainda pendentes?"))
            action(async () => {
              await api(
                "deliveries/" + b.dataset.cancel + "/cancel",
                "POST",
                {},
              );
              await refresh();
              render();
            });
        }),
    );
    document.querySelectorAll("[data-resume]").forEach(
      (b) =>
        (b.onclick = () => {
          if (
            confirm(
              "Continuar apenas destinatários ainda não processados? Os resultados desconhecidos NÃO serão repetidos.",
            )
          )
            action(async () => {
              await api(
                "deliveries/" + b.dataset.resume + "/resume",
                "POST",
                {},
              );
              await refresh();
              render();
            });
        }),
    );
  }
  if (current === "suppressions") {
    view.innerHTML =
      title(
        "Supressões",
        "Endereços nesta lista não receberão novas mensagens. Um envio já em processamento pode ter sido aceito antes da inclusão.",
      ) +
      `<article class="panel"><form id="suppression-form"><label>E-mail<input name="email" type="email" required></label><label>Motivo<input name="reason" maxlength="200" required></label><button>Bloquear destinatário</button></form><div id="suppression-list"></div></article>`;
    const load = () =>
      action(async () => {
        const rows = await api("suppressions");
        document.querySelector("#suppression-list").innerHTML = table(
          ["E-mail", "Motivo"],
          rows.map(
            (r) =>
              `<tr><td>${escape(r.email)}</td><td>${escape(r.reason)}</td></tr>`,
          ),
        );
      });
    load();
    document.querySelector("#suppression-form").onsubmit = (e) => {
      e.preventDefault();
      action(async () => {
        const v = new FormData(e.target);
        await api("suppressions", "POST", {
          email: v.get("email"),
          reason: v.get("reason"),
        });
        e.target.reset();
        load();
        tell("Supressão salva.");
      });
    };
  }
  document
    .querySelector("#new")
    ?.addEventListener("click", () => campaignForm());
  document
    .querySelectorAll("[data-send]")
    .forEach((b) => (b.onclick = () => deliveryForm(b.dataset.send)));
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

async function deliveryForm(id) {
  const c = state.campaigns.find((c) => c.id === id),
    list = state.lists.find((l) => l.id === c.listId);
  view.innerHTML =
    title("Revisar e enviar", c.name) +
    `<article class="panel"><form id="audience"><label>Enviar para<select name="mode"><option value="single">Um destinatário</option><option value="list">Lista da campanha: ${escape(list?.name || "")}</option></select></label><label id="single-label">E-mail do destinatário<input type="email" name="recipient" maxlength="254" required></label><button>Gerar prévia</button></form><div id="preview-send"></div></article>`;
  const form = document.querySelector("#audience"),
    preview = document.querySelector("#preview-send");
  form.onchange = () => {
    const single = form.elements.mode.value === "single";
    form.elements.recipient.required = single;
    document.querySelector("#single-label").hidden = !single;
    preview.innerHTML = "";
  };
  form.oninput = () => {
    preview.innerHTML = "";
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const mode = form.elements.mode.value,
        recipient = form.elements.recipient.value.trim();
      const result = await api("campaigns/" + id + "/preview", "POST", {
        mode,
        recipient,
      });
      const requestId = crypto.randomUUID();
      preview.innerHTML = `<h2>Prévia da campanha</h2><p>De: <strong>${escape(result.sender)}</strong><br>Assunto: ${escape(result.subject)}<br><strong>${result.count} destinatário(s)</strong>; ${result.suppressed} suprimidos e ${result.demonstration} contatos demonstrativos ignorados.</p><pre>${escape(result.body)}</pre>${table(
        ["Destinatários"],
        result.recipients.map((r) => `<tr><td>${escape(r.email)}</td></tr>`),
      )}<label><input type="checkbox" id="permission-confirm"> Tenho autorização para enviar este conteúdo a todos os destinatários exibidos.</label><label><input type="checkbox" id="send-confirm"> Revisei e autorizo o envio real desta campanha agora.</label><button id="send-now" disabled>Enviar campanha para ${result.count} destinatário(s)</button><p>As mensagens serão enviadas individualmente, sem cópias. Não haverá reenvio automático de resultados desconhecidos.</p>${!result.connected ? "<p>Conecte o Google Workspace na aba do app antes de enviar.</p>" : ""}${!result.enabled ? "<p>Envio desativado no backend.</p>" : ""}`;
      const button = document.querySelector("#send-now");
      let submitting = false;
      const update = () =>
        (button.disabled =
          submitting ||
          !result.connected ||
          !result.enabled ||
          !document.querySelector("#permission-confirm").checked ||
          !document.querySelector("#send-confirm").checked);
      document.querySelector("#permission-confirm").onchange = update;
      document.querySelector("#send-confirm").onchange = update;
      button.onclick = () => {
        if (button.disabled) return;
        submitting = true;
        update();
        action(async () => {
          try {
            await api("campaigns/" + id + "/send", "POST", {
              mode,
              recipient,
              selectionHash: result.selectionHash,
              requestId,
              confirmed: true,
              permissionConfirmed: true,
            });
            await refresh();
            location.hash = "deliveries";
            render();
            tell("Envio registrado. Acompanhe os resultados e use Atualizar.");
          } catch (e) {
            await refresh();
            if (state.deliveries.some((j) => j.campaignId === id)) {
              location.hash = "deliveries";
              render();
            } else {
              submitting = false;
              update();
            }
            throw e;
          }
        });
      };
    });
  };
}
