const accountChangeKey = "invoice-account-change";
const logoutButton = document.getElementById("logout-invoice");

async function loadInvoiceAccount() {
  try {
    const response = await fetch("/api/auth/session");
    if (!response.ok) throw new Error();
    const { account } = await response.json();
    if (!account) {
      location.replace("/login.html");
      return null;
    }
    document.querySelector("[data-account-name]").textContent = account.username;
    document.querySelector("[data-admin-link]")?.toggleAttribute("hidden", account.role !== "admin");
    logoutButton.hidden = false;
    return account;
  } catch {
    location.replace("/login.html");
    return null;
  }
}

const invoiceAccount = loadInvoiceAccount();

async function invoiceFetch(url, options = {}) {
  const account = await invoiceAccount;
  if (!account) throw new Error("Sign in to continue.");
  const headers = new Headers(options.headers);
  headers.set("X-Invoice-Account", account.id);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) location.replace("/login.html");
  return response;
}

async function invoiceDraftKey() {
  const account = await invoiceAccount;
  return account ? "invoiceData:" + account.id : null;
}

logoutButton.addEventListener("click", async function () {
  logoutButton.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error();
    const key = await invoiceDraftKey();
    if (key) sessionStorage.removeItem(key);
    localStorage.setItem(accountChangeKey, crypto.randomUUID());
    location.replace("/login.html");
  } catch {
    logoutButton.disabled = false;
    window.alert(invoiceText("Could not sign out. Try again."));
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === accountChangeKey) location.reload();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
