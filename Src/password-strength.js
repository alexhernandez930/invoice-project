const commonInvoicePasswords = new Set([
  "password", "passphrase", "contraseña", "contrasena", "letmein",
  "qwerty", "qwertyuiop", "asdfghjkl", "welcome", "bienvenido",
  "iloveyou", "tequiero", "admin", "administrator", "administrador",
  "invoicemaker", "creadordefacturas", "changeme", "correcthorsebatterystaple",
]);

function passwordComparisonKey(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function invoicePasswordIssue(password, username) {
  if (password.length < 15 || password.length > 128) {
    return "Use a password of 15–128 characters.";
  }

  const key = passwordComparisonKey(password);
  const base = key.replace(/^\d+|\d+$/g, "");
  const usernameKey = passwordComparisonKey(username);
  if (!password.trim() ||
      /^(.+)\1+$/su.test(password) ||
      /^(.+)\1+$/u.test(base || key) ||
      commonInvoicePasswords.has(base) ||
      (usernameKey && (key === usernameKey || base === usernameKey)) ||
      (key && ("0123456789".repeat(13).includes(key) || "9876543210".repeat(13).includes(key) ||
        "abcdefghijklmnopqrstuvwxyz".repeat(5).includes(key)))) {
    return "Choose a less predictable password, such as a longer passphrase.";
  }
  return "";
}

function invoiceNewPasswordIssue(password, confirmation, username) {
  return invoicePasswordIssue(password, username) ||
    (password === confirmation ? "" : "Passwords do not match.");
}

if (typeof module !== "undefined") module.exports = { invoiceNewPasswordIssue };
