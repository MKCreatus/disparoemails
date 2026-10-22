const status = document.querySelector("#status"),
  result = document.querySelector("#result"),
  button = document.querySelector("#send"),
  confirm = document.querySelector("#confirm");
let settings;
function update() {
  button.disabled = !(
    settings?.configured &&
    settings.connected &&
    settings.enabled &&
    !settings.used &&
    confirm.checked
  );
}
async function load() {
  const r = await fetch("/api/google/status");
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error || "Não foi possível verificar a conexão.");
  settings = data;
  document.querySelector("#sender").textContent =
    data.sender || "Não configurado";
  document
    .querySelectorAll(".recipient")
    .forEach((e) => (e.textContent = data.recipient || "Não configurado"));
  status.textContent = !data.configured
    ? "Configure as credenciais no backend."
    : data.used
      ? `Teste já solicitado (${data.attemptStatus}). Não haverá reenvio.`
      : data.connected
        ? data.enabled
          ? "Conta conectada. Pronto para um único teste manual."
          : "Conta conectada; teste real desativado no backend."
        : "Credenciais configuradas. Conecte a conta remetente.";
  update();
}
confirm.onchange = update;
button.onclick = async () => {
  if (button.disabled) return;
  button.disabled = true;
  result.textContent = "Solicitando o teste uma única vez…";
  try {
    const r = await fetch("/api/google/send-test", {
      method: "POST",
      headers: { "X-Test-CSRF": settings.csrf },
    });
    const data = await r.json();
    result.textContent = data.message || data.error;
    await load();
  } catch {
    settings.used = true;
    update();
    result.textContent =
      "Não foi possível confirmar o resultado. Não repita o envio; confira a caixa de entrada e os enviados.";
  }
};
load().catch((e) => {
  status.textContent = e.message;
  button.disabled = true;
});
