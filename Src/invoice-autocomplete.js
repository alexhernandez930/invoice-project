function setupInvoiceAutocomplete({ input, url, minLength, delay, label, details, select, empty, error }) {
  const list = document.getElementById(input.getAttribute("aria-controls"));
  const status = input.parentElement.querySelector('[role="status"]');
  let timer;
  let request;
  let matches = [];
  let active = -1;

  function clear() {
    clearTimeout(timer);
    request?.abort();
    request = undefined;
    matches = [];
    active = -1;
    list.replaceChildren();
    list.hidden = true;
    status.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function showMessage(message) {
    setInvoiceText(status, message);
    status.hidden = false;
  }

  function choose(index) {
    const match = matches[index];
    clear();
    select(match);
  }

  input.addEventListener("input", function (event) {
    clear();
    const query = input.value.trim();
    if (event.isComposing || query.length < minLength) return;

    timer = setTimeout(async function () {
      const pending = new AbortController();
      request = pending;
      const params = new URLSearchParams({ q: query, lang: invoiceLanguage });
      try {
        const response = await invoiceFetch(url + "?" + params, { signal: pending.signal });
        if (!response.ok) throw new Error();
        const options = await response.json();
        if (request !== pending || input.value.trim() !== query) return;
        if (!options.length) {
          showMessage(empty);
          return;
        }

        matches = options;
        matches.forEach(function (match, index) {
          const option = document.createElement("li");
          option.id = list.id + "-" + index;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.textContent = label(match);

          const description = details?.(match);
          if (description) {
            const secondary = document.createElement("span");
            secondary.textContent = description;
            option.appendChild(secondary);
          }
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", () => choose(index));
          list.appendChild(option);
        });
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
      } catch {
        if (request === pending) showMessage(error);
      }
    }, delay);
  });

  input.addEventListener("keydown", function (event) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      clear();
      return;
    }
    if (!matches.length) return;
    if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    list.children[active]?.setAttribute("aria-selected", "false");
    const step = event.key === "ArrowDown" ? 1 : -1;
    active = active < 0 ? (step === 1 ? 0 : matches.length - 1)
      : (active + step + matches.length) % matches.length;
    const option = list.children[active];
    option.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  });

  input.addEventListener("blur", clear);
  return clear;
}

const customerNameInput = document.getElementById("customer-name");
const addressInput = document.getElementById("customer-address");
const clearAddressSuggestions = setupInvoiceAutocomplete({
  input: addressInput,
  url: "/api/invoices/addresses",
  minLength: 5,
  delay: 600,
  label: (address) => address,
  select: (address) => { addressInput.value = address; },
  empty: "No address matches. You can enter it manually.",
  error: "Address suggestions are unavailable. You can enter the address manually.",
});

setupInvoiceAutocomplete({
  input: customerNameInput,
  url: "/api/invoices/customers",
  minLength: 2,
  delay: 180,
  label: (customer) => customer.name,
  details: (customer) => [customer.phone, customer.address].filter(Boolean).join(" · "),
  select: function (customer) {
    clearAddressSuggestions();
    customerNameInput.value = customer.name;
    document.getElementById("customer-phone").value = customer.phone;
    addressInput.value = customer.address;
  },
  empty: "No saved customers match.",
  error: "Could not load saved customers.",
});
