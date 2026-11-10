const form = document.getElementById("account-form");
const heading = document.getElementById("account-heading");
const username = document.getElementById("username");
const password = document.getElementById("password");
const newPasswordFields = document.getElementById("new-password-fields");
const passwordConfirmation = document.getElementById("password-confirmation");
const setupFields = document.getElementById("setup-fields");
const setupTokenInput = document.getElementById("setup-token");
const submitAccount = document.getElementById("submit-account");
const registerButton = document.getElementById("register-account");
const setupButton = document.getElementById("setup-account");
const backButton = document.getElementById("back-to-login");
const status = document.getElementById("account-status");
let mode = "login";
let adminSetupAvailable = false;

function updatePasswordFeedback() {
  if (mode !== "login") renderInvoicePasswordFeedback(password, username.value, passwordConfirmation);
}

function changeMode(nextMode) {
  mode = nextMode;
  const label = { login: "Sign in", register: "Create an account", setup: "Set up administrator" }[mode];
  setInvoiceText(heading, label);
  setInvoiceText(document.querySelector("title"), label);
  setInvoiceText(submitAccount, label);
  status.hidden = true;
  password.value = "";
  const creating = mode !== "login";
  password.autocomplete = creating ? "new-password" : "current-password";
  if (creating) password.setAttribute("aria-describedby", "password-strength-text");
  else password.removeAttribute("aria-describedby");
  newPasswordFields.hidden = !creating;
  passwordConfirmation.disabled = !creating;
  passwordConfirmation.required = creating;
  passwordConfirmation.value = "";
  setupFields.hidden = mode !== "setup";
  setupTokenInput.required = mode === "setup";
  setupTokenInput.value = "";
  registerButton.hidden = mode !== "login";
  setupButton.hidden = mode !== "login" || !adminSetupAvailable;
  backButton.hidden = mode === "login";
  updatePasswordFeedback();
}

[username, password, passwordConfirmation].forEach((input) => {
  input.addEventListener("input", updatePasswordFeedback);
});

registerButton.addEventListener("click", () => changeMode("register"));
setupButton.addEventListener("click", () => changeMode("setup"));
backButton.addEventListener("click", () => changeMode("login"));

fetch("/api/auth/setup").then((response) => response.json()).then(({ available }) => {
  adminSetupAvailable = available;
  setupButton.hidden = mode !== "login" || !available;
}).catch(() => {});

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  const action = mode;
  const fields = {
    username: username.value,
    password: password.value,
    setupToken: setupTokenInput.value,
  };
  if (action !== "login") {
    fields.passwordConfirmation = passwordConfirmation.value;
    const issue = invoiceNewPasswordIssue(fields.password, fields.passwordConfirmation, fields.username.trim());
    if (issue) {
      setInvoiceText(status, issue);
      status.hidden = false;
      (issue === "Passwords do not match." ? passwordConfirmation : password).focus();
      return;
    }
  }
  const buttons = [submitAccount, registerButton, setupButton, backButton];
  buttons.forEach((button) => { button.disabled = true; });
  status.hidden = true;
  try {
    const response = await fetch("/api/auth/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    localStorage.setItem("invoice-account-change", crypto.randomUUID());
    location.replace(action === "setup" ? "admin.html" : "create-invoice.html");
  } catch (error) {
    setInvoiceText(status, invoiceErrorMessage(error, "Could not sign in. Try again."));
    status.hidden = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
});
