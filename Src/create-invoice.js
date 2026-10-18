// --------------------------------------------------
// GET IMPORTANT HTML ELEMENTS
// --------------------------------------------------

const addItemButton = document.getElementById("add-item");
const itemsBody = document.getElementById("items-body");
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

addItemButton.addEventListener("click", function () {
  const newRow = document.createElement("tr");

  newRow.classList.add("item-row");

  newRow.innerHTML = `
    <td>
      <input
        type="text"
        class="item-name"
        placeholder="Item"
      />
    </td>

    <td>
      <input
        type="number"
        class="item-quantity"
        value="1"
        min="1"
      />
    </td>

    <td>
      <textarea
        class="item-description"
        placeholder="Describe the work performed"
      ></textarea>
    </td>

    <td>
      <input
        type="number"
        class="item-price"
        placeholder="0.00"
        min="0"
        step="0.01"
      />
    </td>

    <td>
      <button
        type="button"
        class="remove-item"
      >
        Remove
      </button>
    </td>
  `;

  itemsBody.appendChild(newRow);
});

itemsBody.addEventListener("input", function (event) {
  if (event.target.classList.contains("item-price")) {
    calculateTotal();
  }
});

itemsBody.addEventListener("click", function (event) {
  if (event.target.classList.contains("remove-item")) {
    const row = event.target.closest(".item-row");

    row.remove();

    calculateTotal();
  }
});

previewButton.addEventListener("click", function () {
  const customerName = document.getElementById("customer-name").value;
  const customerAddress = document.getElementById("customer-address").value;
  const customerPhone = document.getElementById("customer-phone").value;
  const jobTitle = document.getElementById("job-title").value;

  const rows = document.querySelectorAll(".item-row");

  const items = [];

  rows.forEach(function (row) {
    const itemName = row.querySelector(".item-name").value;
    const quantity = row.querySelector(".item-quantity").value;
    const description = row.querySelector(".item-description").value;
    const price = row.querySelector(".item-price").value;

    items.push({
      name: itemName,
      quantity: quantity,
      description: description,
      price: price,
    });
  });

  // Put all invoice information together
  const invoiceData = {
    customerName: customerName,
    customerAddress: customerAddress,
    customerPhone: customerPhone,
    jobTitle: jobTitle,
    items: items,
    total: invoiceTotal.textContent,
  };

  sessionStorage.setItem(
    "invoiceData",
    JSON.stringify(invoiceData)
  );

  window.location.href = "invoice.html";
});