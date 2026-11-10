const logoDialog = document.getElementById("account-logo-dialog");
const logoForm = document.getElementById("account-logo-form");
const logoPhoto = document.getElementById("logo-photo");
const logoPreview = document.getElementById("account-logo-preview");
const logoStatus = document.getElementById("logo-upload-status");
const saveLogo = document.getElementById("save-logo");
const resetLogo = document.getElementById("reset-logo");
const closeLogo = document.getElementById("close-logo-dialog");
const logoUrl = "/api/auth/logo";
let logoCandidate;
let logoPreviewUrl;
let logoBusy = false;

logoPreview.addEventListener("error", () => {
  if (!logoPreview.src.endsWith("/palm_cute.webp")) logoPreview.src = "/palm_cute.webp";
});

function showAccountLogo() {
  if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
  logoPreviewUrl = undefined;
  logoPreview.src = logoUrl + "?v=" + Date.now();
}

async function prepareLogo(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

document.getElementById("my-logo").addEventListener("click", () => {
  logoForm.reset();
  logoCandidate = undefined;
  saveLogo.disabled = true;
  setInvoiceText(logoStatus, "");
  showAccountLogo();
  logoDialog.showModal();
});

closeLogo.addEventListener("click", () => logoDialog.close());
logoDialog.addEventListener("cancel", (event) => {
  if (logoBusy) event.preventDefault();
});
logoDialog.addEventListener("close", () => {
  logoForm.reset();
  logoCandidate = undefined;
  if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
  logoPreviewUrl = undefined;
});

logoPhoto.addEventListener("change", async () => {
  const file = logoPhoto.files[0];
  logoCandidate = undefined;
  saveLogo.disabled = true;
  showAccountLogo();
  setInvoiceText(logoStatus, "");
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    setInvoiceText(logoStatus, "The logo image is too large.");
    return;
  }
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error();
    const candidate = await prepareLogo(file);
    if (!candidate) throw new Error();
    if (!logoDialog.open || logoPhoto.files[0] !== file) return;
    logoCandidate = candidate;
    logoPreviewUrl = URL.createObjectURL(candidate);
    logoPreview.src = logoPreviewUrl;
    saveLogo.disabled = false;
  } catch {
    if (logoPhoto.files[0] === file) setInvoiceText(logoStatus, "Choose a valid PNG, JPEG, or WebP image.");
  }
});

async function updateAccountLogo(method) {
  logoBusy = true;
  saveLogo.disabled = resetLogo.disabled = closeLogo.disabled = logoPhoto.disabled = true;
  setInvoiceText(logoStatus, "Saving logo…");
  try {
    const response = await invoiceFetch(logoUrl, {
      method,
      body: method === "PUT" ? logoCandidate : undefined,
    });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({}));
      throw new Error(error);
    }
    logoForm.reset();
    logoCandidate = undefined;
    showAccountLogo();
    setInvoiceText(logoStatus, method === "PUT" ? "Logo saved to your account." : "Default logo restored.");
  } catch (error) {
    setInvoiceText(logoStatus, invoiceErrorMessage(error, "Could not update the logo. Try again."));
  } finally {
    logoBusy = false;
    resetLogo.disabled = closeLogo.disabled = logoPhoto.disabled = false;
    saveLogo.disabled = !logoCandidate;
  }
}

logoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (logoCandidate && !logoBusy) updateAccountLogo("PUT");
});
resetLogo.addEventListener("click", () => {
  if (!logoBusy) updateAccountLogo("DELETE");
});
