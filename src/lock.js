// A simple password gate in front of building. The site is static, so this keeps
// casual visitors from spending your API credits; it is not real security.
const PASSWORD_SHA256 = "2c4779e28ec964baa2afdeb862be4b9776562866443cfcf22f37950c20ed0af2";
const UNLOCK_KEY = "gb.unlocked";

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() {
  try {
    return localStorage.getItem(UNLOCK_KEY) === PASSWORD_SHA256;
  } catch {
    return false;
  }
}

/** Resolves true once the right password has been entered on this device. */
export function ensureUnlocked() {
  if (isUnlocked()) return Promise.resolve(true);

  const dialog = document.getElementById("lock");
  const form = document.getElementById("lockForm");
  const input = document.getElementById("lockInput");
  const error = document.getElementById("lockError");
  const cancel = document.getElementById("lockCancel");
  input.value = "";
  error.hidden = true;
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    const finish = (ok) => {
      form.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    const onSubmit = async (e) => {
      e.preventDefault();
      if ((await sha256(input.value.trim())) === PASSWORD_SHA256) {
        try {
          localStorage.setItem(UNLOCK_KEY, PASSWORD_SHA256);
        } catch {}
        return finish(true);
      }
      error.hidden = false;
      input.select();
      dialog.classList.remove("shake");
      void dialog.offsetWidth;
      dialog.classList.add("shake");
    };
    const onClose = () => finish(false);
    cancel.onclick = () => finish(false);
    form.addEventListener("submit", onSubmit);
    dialog.addEventListener("close", onClose);
  });
}
