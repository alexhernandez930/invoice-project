const resetDialog = document.getElementById("reset-password-dialog");
const resetForm = document.getElementById("reset-password-form");
const resetPassword = document.getElementById("reset-password");
const resetConfirmation = document.getElementById("password-confirmation");
const resetError = document.getElementById("reset-password-error");
const resetSubmit = document.getElementById("submit-password-reset");
const resetCancel = document.getElementById("cancel-password-reset");
const adminStatus = document.getElementById("admin-status");
let resetUser;

function showResetFeedback() {
  renderInvoicePasswordFeedback(resetPassword, resetUser.username, resetConfirmation);
}

function openPasswordReset(user) {
  resetUser = user;
  resetForm.reset();
  resetError.hidden = true;
  document.getElementById("reset-username").textContent = user.username;
  showResetFeedback();
  resetDialog.showModal();
}

resetPassword.addEventListener("input", showResetFeedback);
resetConfirmation.addEventListener("input", showResetFeedback);
resetCancel.addEventListener("click", () => resetDialog.close());
resetDialog.addEventListener("cancel", (event) => {
  if (resetSubmit.disabled) event.preventDefault();
});
resetDialog.addEventListener("close", () => {
  resetForm.reset();
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = resetPassword.value;
  const passwordConfirmation = resetConfirmation.value;
  const issue = invoiceNewPasswordIssue(password, passwordConfirmation, resetUser.username);
  if (issue) {
    setInvoiceText(resetError, issue);
    resetError.hidden = false;
    (issue === "Passwords do not match." ? resetConfirmation : resetPassword).focus();
    return;
  }

  resetSubmit.disabled = resetCancel.disabled = resetPassword.disabled = resetConfirmation.disabled = true;
  resetError.hidden = true;
  try {
    const response = await invoiceFetch("/api/auth/users/" + encodeURIComponent(resetUser.id) + "/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, passwordConfirmation }),
    });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(error);
    }
    resetDialog.close();
    setInvoiceText(adminStatus, "Password reset. The user can sign in with the new password.");
  } catch (error) {
    setInvoiceText(resetError, invoiceErrorMessage(error, "Could not reset the password. Try again."));
    resetError.hidden = false;
  } finally {
    resetSubmit.disabled = resetCancel.disabled = resetPassword.disabled = resetConfirmation.disabled = false;
  }
});

async function loadUsers() {
  const account = await invoiceAccount;
  if (!account) return;
  const list = document.getElementById("account-list");
  try {
    const response = await invoiceFetch("/api/auth/users");
    if (!response.ok) throw new Error();
    const users = await response.json();
    for (const user of users) {
      const row = list.insertRow();
      row.insertCell().textContent = user.username;
      setInvoiceText(row.insertCell(), user.role === "admin" ? "Administrator" : "User");
      const link = document.createElement("a");
      link.href = "invoices.html?owner=" + encodeURIComponent(user.id);
      setInvoiceText(link, "View invoices");
      row.insertCell().appendChild(link);
      const passwordCell = row.insertCell();
      if (user.role === "user") {
        const reset = document.createElement("button");
        reset.type = "button";
        setInvoiceText(reset, "Reset password");
        reset.addEventListener("click", () => openPasswordReset(user));
        passwordCell.appendChild(reset);
      }
    }
  } catch {
    setInvoiceText(adminStatus, "Could not load user accounts.");
  }
}

loadUsers();
