// Shared API keys, encrypted with the app password and stored in the public repo.
// Only someone who knows the password can decrypt them; the password itself is never stored there.

export const VAULT_FILE = "keys.enc.json"; // served from the site root (public/keys.enc.json in the repo)
const ITERATIONS = 600_000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    true, // exportable, so a device can remember it instead of the password
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt `payload` (an object) with `password`. Pass the current file's salt when the password
 * stays the same, so devices that remember the key keep working without asking again.
 */
export async function sealVault(password, payload, keepSalt) {
  const salt = keepSalt ? unb64(keepSalt) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  const file = { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
  return { file, rememberedKey: { salt: file.salt, raw: b64(await crypto.subtle.exportKey("raw", key)) } };
}

async function decrypt(file, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, key, unb64(file.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Decrypt with a password. Throws on a wrong password. */
export async function openVault(file, password) {
  const key = await deriveKey(password, unb64(file.salt), file.iterations);
  const payload = await decrypt(file, key);
  return { payload, rememberedKey: { salt: file.salt, raw: b64(await crypto.subtle.exportKey("raw", key)) } };
}

/** Decrypt with a key this device remembered. Returns null if it no longer fits (password changed). */
export async function openVaultWithKey(file, remembered) {
  if (!remembered || remembered.salt !== file.salt) return null;
  try {
    const key = await crypto.subtle.importKey("raw", unb64(remembered.raw), "AES-GCM", false, ["decrypt"]);
    return await decrypt(file, key);
  } catch {
    return null;
  }
}

export async function fetchVault() {
  const res = await fetch(`${VAULT_FILE}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`vault ${res.status}`);
  return res.json();
}
