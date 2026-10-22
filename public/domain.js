export const sendingEnabled = false;
export function sendEmail() {
  throw new Error("Envios reais desativados: versão demonstrativa.");
}
export function parseCSV(text) {
  if (text.length > 2_000_000) throw new Error("CSV excede 2 MB.");
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = source.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (!quoted && field.length)
        throw new Error("Aspas inválidas no CSV.");
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Campo com aspas não fechado.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map((v) => v.trim().toLowerCase());
  if (!headers.includes("email"))
    throw new Error("Inclua a coluna email. Colunas opcionais: nome, empresa.");
  const contacts = [],
    seen = new Set();
  let invalid = 0,
    duplicates = 0;
  for (const values of rows) {
    const email = (values[headers.indexOf("email")] || "").trim().toLowerCase();
    if (
      values.length !== headers.length ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    contacts.push({
      email,
      nome: (values[headers.indexOf("nome")] || "").trim(),
      empresa: (values[headers.indexOf("empresa")] || "").trim(),
      consentimento: "Não verificado",
    });
  }
  return { contacts, invalid, duplicates };
}
export function seed() {
  return {
    campaigns: [
      {
        id: "demo-1",
        name: "Boas-vindas à nossa comunidade",
        subject: "Que bom ter você por aqui!",
        status: "Simulada",
        audience: 1250,
        delivered: 1218,
        opened: 463,
        clicked: 134,
      },
      {
        id: "demo-2",
        name: "Novidades de outubro",
        subject: "Veja o que preparamos para você",
        status: "Rascunho",
        audience: 840,
        delivered: 0,
        opened: 0,
        clicked: 0,
      },
    ],
    contacts: [
      {
        nome: "Ana Demo",
        email: "ana@example.com",
        empresa: "Empresa Exemplo",
        consentimento: "Demonstrativo",
      },
      {
        nome: "Bruno Demo",
        email: "bruno@example.org",
        empresa: "Estúdio Exemplo",
        consentimento: "Demonstrativo",
      },
    ],
    templates: [
      {
        id: "welcome",
        name: "Boas-vindas",
        subject: "Boas-vindas, {{nome}}!",
        body: "Olá, {{nome}}!\n\nÉ um prazer receber você. Conheça nossas novidades.\n\nEquipe Exemplo",
      },
      {
        id: "news",
        name: "Newsletter",
        subject: "As novidades do mês",
        body: "Olá, {{nome}}!\n\nConfira as novidades que selecionamos para você.\n\nEquipe Exemplo",
      },
    ],
  };
}
