const form = document.getElementById("invoice-search");
const input = document.getElementById("query");
const status = document.getElementById("search-status");
const results = document.getElementById("invoice-results");
const resultsRegion = document.getElementById("search-results");
const more = document.getElementById("more-invoices");
const owner = new URLSearchParams(location.search).get("owner");
const ownerLabel = document.getElementById("archive-owner");
let search = "";
let next = null;
let activeRequest;

async function searchInvoices(append = false) {
  activeRequest?.abort();
  const request = new AbortController();
  activeRequest = request;

  if (!append) {
    search = input.value.trim();
    next = null;
    results.replaceChildren();
    resultsRegion.hidden = true;
    more.hidden = true;
  }

  const params = new URLSearchParams({ q: search });
  if (owner !== null) params.set("owner", owner);
  if (next !== null) params.set("before", next);
  more.disabled = true;
  setInvoiceText(status, "Loading invoices…");

  try {
    const response = await invoiceFetch("/api/invoices?" + params, { signal: request.signal });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (activeRequest !== request) return;
    if (owner !== null) {
      setInvoiceText(ownerLabel.firstElementChild, data.ownerName ? "Invoices created by" : "Invoices created before accounts");
      ownerLabel.lastElementChild.textContent = data.ownerName || "";
      ownerLabel.hidden = false;
    }

    data.invoices.forEach(function (invoice) {
      const row = results.insertRow();
      const link = document.createElement("a");
      link.href = "invoice.html?id=" + invoice.id;
      link.textContent = invoice.invoiceNumber;
      row.insertCell().appendChild(link);
      row.insertCell().textContent = invoice.customerName;
      row.insertCell().textContent = invoice.customerPhone;
      row.insertCell().textContent = invoice.customerAddress;
      const date = document.createElement("time");
      date.dateTime = invoice.invoiceDate;
      renderInvoiceDate(date);
      row.insertCell().appendChild(date);
      row.insertCell().textContent = invoice.total;
    });
    next = data.next;
    more.hidden = next === null;
    resultsRegion.hidden = results.rows.length === 0;
    const emptyMessage = search ? "No invoices match your search." : "No invoices saved yet.";
    setInvoiceText(status, resultsRegion.hidden ? emptyMessage : "");
  } catch (error) {
    if (activeRequest === request) {
      setInvoiceText(status, "Could not load saved invoices. Try again.");
    }
  } finally {
    if (activeRequest === request) more.disabled = false;
  }
}

form.addEventListener("submit", function (event) {
  event.preventDefault();
  searchInvoices();
});
more.addEventListener("click", function () {
  searchInvoices(true);
});
searchInvoices();
