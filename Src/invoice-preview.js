const savedInvoice = sessionStorage.getItem("invoiceData");

if (savedInvoice) {
  const invoice = JSON.parse(savedInvoice);

  document.getElementById("preview-customer-name").textContent =
    invoice.customerName;

  document.getElementById("preview-address").textContent =
    invoice.customerAddress;

  document.getElementById("preview-phone").textContent = invoice.customerPhone;

  document.getElementById("preview-job-title").textContent = invoice.jobTitle;

  document.getElementById("preview-total").textContent = invoice.total;

  const itemsTable = document.getElementById("preview-items");

  invoice.items.forEach(function (item) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${item.description}</td>
      <td>$${Number(item.price).toFixed(2)}</td>
    `;

    itemsTable.appendChild(row);
  });
}
