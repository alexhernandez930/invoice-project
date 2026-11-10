// --------------------------------------------------
// GET IMPORTANT HTML ELEMENTS
// --------------------------------------------------

const addItemButton = document.getElementById("add-item");
const itemsBody = document.getElementById("items-body");
const itemRowTemplate = itemsBody.querySelector(".item-row").cloneNode(true);
const invoiceTotal = document.getElementById("invoice-total");
const previewButton = document.getElementById("preview-invoice");

// --------------------------------------------------
// CALCULATE INVOICE TOTAL
// --------------------------------------------------

function calculateTotal() {
  const prices = document.querySelectorAll(".item-price");

  let total = 0;

  prices.forEach(function (priceInput) {
    const price = Number(priceInput.value);

    if (!isNaN(price)) {
      total += price;
    }
  });

  invoiceTotal.textContent = "$" + total.toFixed(2);
}

// --------------------------------------------------
// ADD NEW ITEM
// --------------------------------------------------

function addItemRow() {
  const newRow = itemRowTemplate.cloneNode(true);
  translateInvoicePage(newRow);
  itemsBody.appendChild(newRow);
  return newRow;
}

function updateRequiredPrice(input) {
  if (input.required) input.setAttribute("aria-invalid", String(input.value === ""));
}

function fillItemRow(row, item) {
  row.querySelector(".item-name").value = item.name;
  row.querySelector(".item-quantity").value = item.quantity;
  row.querySelector(".item-description").value = item.description;
  const price = row.querySelector(".item-price");
  price.value = item.price;
  if (item.priceRequired) {
    price.required = true;
    price.dataset.i18nPlaceholder = "Enter price";
    price.placeholder = invoiceText("Enter price");
    updateRequiredPrice(price);
  }
}

addItemButton.addEventListener("click", function () {
  addItemRow().querySelector(".item-name").focus();
});

// --------------------------------------------------
// UPDATE TOTAL WHEN PRICE CHANGES
// --------------------------------------------------

itemsBody.addEventListener("input", function (event) {
  if (event.target.classList.contains("item-price")) {
    updateRequiredPrice(event.target);
    calculateTotal();
  }
});

// --------------------------------------------------
// REMOVE ITEM
// --------------------------------------------------

itemsBody.addEventListener("click", function (event) {
  if (event.target.classList.contains("remove-item")) {
    const row = event.target.closest(".item-row");

    row.remove();

    calculateTotal();
  }
});

// --------------------------------------------------
// EDIT OR PREVIEW INVOICE
// --------------------------------------------------

async function restoreInvoiceDraft() {
  if (!new URLSearchParams(location.search).has("edit")) return;
  const key = await invoiceDraftKey();
  if (!key) return;
  const draft = JSON.parse(sessionStorage.getItem(key));
  if (draft) {
    document.getElementById("customer-name").value = draft.customerName;
    document.getElementById("customer-address").value = draft.customerAddress;
    document.getElementById("customer-phone").value = draft.customerPhone;
    document.getElementById("job-title").value = draft.jobTitle;

    if (draft.items.length) {
      itemsBody.replaceChildren();
      draft.items.forEach(function (item) {
        fillItemRow(addItemRow(), item);
      });
      calculateTotal();
    }
  }
}

restoreInvoiceDraft();

previewButton.addEventListener("click", async function () {
  const key = await invoiceDraftKey();
  if (!key) return;
  const invalidPrice = itemsBody.querySelector(".item-price:required:invalid");
  if (invalidPrice) {
    setInvoiceText(document.getElementById("work-assistant-status"), "Enter a valid price for each suggested item before previewing.");
    invalidPrice.focus();
    return;
  }

  // Customer information
  const customerName = document.getElementById("customer-name").value;

  const customerAddress = document.getElementById("customer-address").value;

  const customerPhone = document.getElementById("customer-phone").value;

  const jobTitle = document.getElementById("job-title").value;

  // Get every invoice item row
  const rows = document.querySelectorAll(".item-row");

  const items = [];

  // Read each item
  rows.forEach(function (row) {
    const itemName = row.querySelector(".item-name").value;

    const quantity = row.querySelector(".item-quantity").value;

    const description = row.querySelector(".item-description").value;

    const priceInput = row.querySelector(".item-price");

    items.push({
      name: itemName,
      quantity: quantity,
      description: description,
      price: priceInput.value,
      priceRequired: priceInput.required,
    });
  });

  // Put all invoice information together
  const invoiceData = {
    draftId: crypto.randomUUID(),
    customerName: customerName,
    customerAddress: customerAddress,
    customerPhone: customerPhone,
    jobTitle: jobTitle,
    items: items,
    total: invoiceTotal.textContent,
  };

  // Save the invoice temporarily
  sessionStorage.setItem(key, JSON.stringify(invoiceData));

  // Open the invoice preview
  window.location.href = "invoice.html";
});
