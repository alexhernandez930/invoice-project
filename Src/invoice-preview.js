const printButton = document.getElementById("print-invoice");
const saveButton = document.getElementById("save-invoice");
const editButton = document.getElementById("edit-invoice");
const status = document.getElementById("invoice-status");
const invoiceId = new URLSearchParams(location.search).get("id");

function showStatus(message) {
  setInvoiceText(status, message);
  status.hidden = !message;
}

function renderJobDetails(invoice) {
  document.getElementById("preview-address").textContent = invoice.customerAddress;
  const english = invoiceLanguage === "en";
  document.getElementById("preview-job-title").textContent = english
    ? invoice.jobTitleEnglish ?? invoice.jobTitle
    : invoice.jobTitle;
  const notice = document.getElementById("job-translation-status");
  notice.hidden = !english || !invoice.jobTitle.trim() || invoice.jobTitleEnglish != null;
  if (!notice.hidden) setInvoiceText(notice, "English translation is unavailable. Showing the original job title.");
}

function needsEnglishItemText(item) {
  return (item.name.trim() && !item.nameEnglish?.trim()) ||
    (item.description.trim() && !item.descriptionEnglish?.trim());
}

function renderLineItems(invoice) {
  const english = invoiceLanguage === "en";
  const itemsTable = document.getElementById("preview-items");
  itemsTable.replaceChildren();
  invoice.items.forEach(function (item) {
    const row = itemsTable.insertRow();
    row.insertCell().textContent = (english && item.nameEnglish) || item.name;
    row.insertCell().textContent = item.quantity;
    row.insertCell().textContent = (english && item.descriptionEnglish) || item.description;
    row.insertCell().textContent = "$" + Number(item.price).toFixed(2);
  });
  const notice = document.getElementById("item-translation-status");
  notice.hidden = !english || !invoice.items.some(needsEnglishItemText);
  if (!notice.hidden) {
    setInvoiceText(notice, "Some invoice items could not be translated. Review their original wording before printing.");
  }
}

function renderInvoice(invoice) {
  renderJobDetails(invoice);
  renderLineItems(invoice);
  document.getElementById("preview-customer-name").textContent = invoice.customerName;
  document.getElementById("preview-phone").textContent = invoice.customerPhone;
  document.getElementById("preview-total").textContent = invoice.total;

  if (invoice.invoiceNumber) {
    document.querySelector("title").dataset.invoiceNumber = invoice.invoiceNumber;
    document.title = invoice.invoiceNumber + " - " + invoiceText("Invoice");
    const number = document.getElementById("preview-invoice-number");
    delete number.dataset.i18n;
    number.textContent = invoice.invoiceNumber;
  }

  const date = document.getElementById("preview-date");
  if (invoice.invoiceDate) {
    date.dateTime = invoice.invoiceDate;
  } else {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    date.dateTime = today.getFullYear() + "-" + month + "-" + day;
  }
  renderInvoiceDate(date);

  document.querySelector(".invoice").hidden = false;
}

async function requestInvoice(url, options) {
  const response = await invoiceFetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function translateJobTitle(title) {
  if (!title.trim()) return null;
  try {
    const translation = await requestInvoice("/api/invoices/assistant/job-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return translation.title;
  } catch {
    return null;
  }
}

async function translateMissingItemText(items) {
  const pending = items.filter(needsEnglishItemText);
  let offset = 0;
  while (offset < pending.length) {
    const rows = [];
    let length = 2;
    for (const { name, description } of pending.slice(offset, offset + 25)) {
      const text = { name: name.trim(), description: description.trim() };
      const size = JSON.stringify(text).length + 1;
      if (rows.length && length + size > 6000) break;
      rows.push(text);
      length += size;
    }
    try {
      const result = await requestInvoice("/api/invoices/assistant/item-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows }),
      });
      result.items.forEach(({ nameEnglish, descriptionEnglish }, index) => {
        Object.assign(pending[offset + index], { nameEnglish, descriptionEnglish });
      });
    } catch {
      return;
    }
    offset += rows.length;
  }
}

async function prepareInvoice(invoice) {
  const logo = document.querySelector(".invoice .logo");
  if (invoiceId === null) logo.src = "/api/auth/logo";
  else if (invoice.ownerId) logo.src = "/api/auth/logo/" + encodeURIComponent(invoice.ownerId);

  const [englishTitle] = await Promise.all([
    invoice.jobTitleEnglish ?? translateJobTitle(invoice.jobTitle),
    translateMissingItemText(invoice.items),
    logo.decode().catch(() => {
      logo.src = "/palm_cute.webp";
      return logo.decode().catch(() => {});
    }),
  ]);
  invoice.jobTitleEnglish = englishTitle;
  renderInvoice(invoice);
  languageToggle.addEventListener("click", () => {
    renderJobDetails(invoice);
    renderLineItems(invoice);
  });
}

function enableInvoiceEditing(invoice, url) {
  const dialog = document.getElementById("edit-invoice-dialog");
  const form = document.getElementById("edit-invoice-form");
  const address = document.getElementById("edit-address");
  const job = document.getElementById("edit-job");
  const submit = document.getElementById("save-invoice-edit");
  const cancel = document.getElementById("cancel-invoice-edit");
  const message = document.getElementById("edit-invoice-error");

  editButton.hidden = false;
  editButton.addEventListener("click", function () {
    address.value = invoice.customerAddress;
    job.value = invoice.jobTitle;
    message.hidden = true;
    dialog.showModal();
  });
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", function (event) {
    if (submit.disabled) event.preventDefault();
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const changes = {};
    if (address.value.trim() !== invoice.customerAddress) {
      changes.customerAddress = address.value.trim();
    }
    if (job.value.trim() !== invoice.jobTitle) {
      changes.jobTitle = job.value.trim();
    }
    if (!Object.keys(changes).length) {
      dialog.close();
      return;
    }

    submit.disabled = cancel.disabled = address.disabled = job.disabled = true;
    message.hidden = true;
    try {
      if (changes.jobTitle !== undefined) {
        changes.jobTitleEnglish = await translateJobTitle(changes.jobTitle);
      }
      const updated = await requestInvoice(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const previousTranslation = updated.jobTitle === invoice.jobTitle ? invoice.jobTitleEnglish : null;
      Object.assign(invoice, updated);
      invoice.jobTitleEnglish ??= previousTranslation;
      renderJobDetails(invoice);
      dialog.close();
      showStatus("Invoice changes saved.");
    } catch (error) {
      setInvoiceText(message, invoiceErrorMessage(error, "Could not save changes."));
      message.hidden = false;
    } finally {
      submit.disabled = cancel.disabled = address.disabled = job.disabled = false;
    }
  });
}

async function loadInvoice() {
  if (invoiceId !== null) {
    showStatus("Loading invoice…");
    try {
      const url = "/api/invoices/" + encodeURIComponent(invoiceId);
      const invoice = await requestInvoice(url);
      await prepareInvoice(invoice);
      if (invoice.canEdit) enableInvoiceEditing(invoice, url);
      else {
        const ownership = document.getElementById("invoice-owner");
        setInvoiceText(ownership.firstElementChild, invoice.ownerName ? "Created by" : "Invoices created before accounts");
        ownership.lastElementChild.textContent = invoice.ownerName || "";
        ownership.hidden = false;
        const archive = document.getElementById("invoice-archive");
        archive.href = "invoices.html?owner=" + encodeURIComponent(invoice.ownerId || "legacy");
      }
      printButton.hidden = false;
      showStatus("");
    } catch (error) {
      showStatus(invoiceErrorMessage(error, "Could not load the invoice."));
    }
    return;
  }

  const key = await invoiceDraftKey();
  if (!key) return;
  const draft = JSON.parse(sessionStorage.getItem(key));
  if (!draft) {
    showStatus("No invoice to preview. Create an invoice or open one from Saved invoices.");
    return;
  }

  if (!draft.draftId) {
    draft.draftId = crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify(draft));
  }
  showStatus("Preparing invoice preview…");
  await prepareInvoice(draft);
  document.getElementById("edit-draft").hidden = false;
  saveButton.hidden = false;
  showStatus("Save this draft to assign the next invoice number and save today's date.");

  const confirmation = document.getElementById("confirm-save");
  saveButton.addEventListener("click", function () {
    confirmation.returnValue = "";
    confirmation.showModal();
  });
  confirmation.addEventListener("close", async function () {
    if (confirmation.returnValue !== "save") return;
    saveButton.disabled = true;
    showStatus("Saving invoice…");
    try {
      const { id } = await requestInvoice("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      sessionStorage.removeItem(key);
      location.replace("invoice.html?id=" + id);
    } catch (error) {
      showStatus(invoiceErrorMessage(error, "Could not save the invoice."));
      saveButton.disabled = false;
    }
  });
}

printButton.addEventListener("click", function () {
  window.print();
});

loadInvoice();
