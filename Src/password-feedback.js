function renderInvoicePasswordFeedback(password, username, passwordConfirmation) {
  const passwordStrength = document.getElementById("password-strength");
  const passwordStrengthText = document.getElementById("password-strength-text");
  const passwordMatch = document.getElementById("password-match");
  const value = password.value;
  const issue = invoicePasswordIssue(value, username.trim());
  const score = !value ? 0 : issue ? 1 : value.length < 20 ? 2 : 3;
  const lengthHint = "Use a password of 15–128 characters.";
  const weakHint = issue === lengthHint
    ? "Weak password. Use at least 15 characters."
    : "Weak password. Try a less predictable passphrase.";
  const labels = [lengthHint, weakHint, "Fair password", "Strong password"];
  passwordStrength.value = score;
  passwordStrengthText.dataset.score = score;
  setInvoiceText(passwordStrengthText, labels[score]);

  const confirmation = passwordConfirmation.value;
  const matches = confirmation === value;
  passwordMatch.classList.toggle("password-error", Boolean(confirmation && !matches));
  passwordConfirmation.setAttribute("aria-invalid", String(Boolean(confirmation && !matches)));
  setInvoiceText(passwordMatch, confirmation ? (matches ? "Passwords match." : "Passwords do not match.") : "");
}
