// The whole app sits behind the password. The password decrypts the shared API keys
// (see vault.js), so it's both the lock and the way every device gets the keys.
import { fetchVault, openVault, openVaultWithKey } from "./vault.js";

const REMEMBER_KEY = "gb.vaultKey";
const CACHED_KEY = "gb.vaultCache"; // last vault file, so the app still opens offline

const load = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function rememberKey(rememberedKey) {
  save(REMEMBER_KEY, rememberedKey);
}

/** After an admin saves new keys: keep this device unlocked until the new file is deployed. */
export function adoptVault(file, rememberedKey) {
  save(CACHED_KEY, file);
  rememberKey(rememberedKey);
}

/** Resolves with the shared keys once this device is unlocked. Asks for the password when needed. */
export async function unlockApp() {
  let file;
  try {
    file = await fetchVault();
    save(CACHED_KEY, file);
  } catch {
    file = load(CACHED_KEY);
  }
  const quiet = file && (await openVaultWithKey(file, load(REMEMBER_KEY)));
  if (quiet) return quiet;
  return askPassword(file);
}

function askPassword(file) {
  const dialog = document.getElementById("lock");
  const form = document.getElementById("lockForm");
  const input = document.getElementById("lockInput");
  const error = document.getElementById("lockError");
  const button = form.querySelector("button");
  input.value = "";
  error.hidden = true;
  dialog.addEventListener("cancel", (e) => e.preventDefault()); // no way around the lock
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!file) {
        error.textContent = "Can't reach the lab. Connect to the internet and try again.";
        error.hidden = false;
        try {
          file = await fetchVault();
          save(CACHED_KEY, file);
        } catch {
          return;
        }
      }
      button.disabled = true;
      button.textContent = "Checking…";
      try {
        const { payload, rememberedKey } = await openVault(file, input.value.trim());
        rememberKey(rememberedKey);
        dialog.close();
        resolve(payload);
      } catch {
        error.textContent = "Wrong password. The professor is unimpressed.";
        error.hidden = false;
        input.select();
        dialog.classList.remove("shake");
        void dialog.offsetWidth;
        dialog.classList.add("shake");
      } finally {
        button.disabled = false;
        button.textContent = "Unlock";
      }
    };
  });
}
