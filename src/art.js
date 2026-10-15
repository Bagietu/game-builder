// Game art from Google's Gemini image models: generate, cut out the background, shrink, store.

const API = "https://generativelanguage.googleapis.com/v1beta";
let modelPromise = null;

async function gemini(key, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key, ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(res.status === 400 && /api key/i.test(msg) ? "Gemini rejected the API key." : `Gemini: ${msg}`);
  }
  return body;
}

/** Pick an image-capable Gemini model from what this key can use (names change often). */
function imageModel(key) {
  modelPromise ??= gemini(key, "models?pageSize=200").then(({ models = [] }) => {
    const usable = models.filter(
      (m) => /image/i.test(m.name) && !/imagen/i.test(m.name) && m.supportedGenerationMethods?.includes("generateContent"),
    );
    const pick = usable.find((m) => /flash/i.test(m.name) && !/lite/i.test(m.name)) || usable[0];
    if (!pick) throw new Error("This Gemini key has no image model available.");
    return pick.name; // e.g. "models/…"
  });
  modelPromise.catch(() => (modelPromise = null));
  return modelPromise;
}

async function generateImage(key, prompt, signal) {
  const model = await imageModel(key);
  const body = await gemini(key, `${model}:generateContent`, {
    method: "POST",
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error("Gemini didn't return an image.");
  return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read the generated image."));
    img.src = src;
  });

/** Remove the flat magenta backdrop, crop to the object and shrink. Returns { url, w, h }. */
async function cutOutSprite(src, maxSize = 256) {
  const img = await loadImage(src);
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    // Distance from pure magenta; soften the edge so outlines don't look jagged.
    const d = Math.hypot(255 - r, g, 255 - b);
    if (d < 110) px[i + 3] = 0;
    else if (d < 170) px[i + 3] = Math.round(((d - 110) / 60) * 255);
    if (px[i + 3] > 20) {
      const p = i / 4, x = p % c.width, y = (p / c.width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(data, 0, 0);
  if (maxX < 0) throw new Error("The sprite came out empty.");
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const out = Object.assign(document.createElement("canvas"), { width: Math.round(w * scale), height: Math.round(h * scale) });
  out.getContext("2d").drawImage(c, minX, minY, w, h, 0, 0, out.width, out.height);
  return { url: out.toDataURL("image/png"), w: out.width, h: out.height };
}

async function shrinkBackground(src, maxSize = 1024) {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const out = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  out.getContext("2d").drawImage(img, 0, 0, out.width, out.height);
  return { url: out.toDataURL("image/jpeg", 0.82), w: out.width, h: out.height };
}

/**
 * Draw every asset ({ key, kind: "sprite" | "background", description }) in `style`.
 * Calls onAsset(key, asset) as each finishes. Resolves with { key: { url, w, h, kind, description } };
 * assets that fail are left out (the game draws those in code instead).
 */
export async function drawAssets({ key, assets, style, signal, onAsset }) {
  const result = {};
  const queue = [...assets];
  const worker = async () => {
    for (let a; (a = queue.shift()); ) {
      if (signal?.aborted) return;
      try {
        const prompt =
          a.kind === "background"
            ? `2D video game background art: ${a.description}. Style: ${style}. Wide landscape composition, no characters, no text, no UI.`
            : `2D video game sprite: ${a.description}. Style: ${style}. One single object, centered, whole object visible with margin, facing right, on a flat solid pure magenta (#FF00FF) background, no shadow on the ground, no text, crisp clean edges.`;
        const raw = await generateImage(key, prompt, signal);
        const img = a.kind === "background" ? await shrinkBackground(raw) : await cutOutSprite(raw);
        result[a.key] = { ...img, kind: a.kind, description: a.description };
        onAsset?.(a.key, result[a.key]);
      } catch (err) {
        if (/rejected the API key|no image model/i.test(err.message)) throw err;
        console.warn("art", a.key, err);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return result;
}

// ---- Storage: images are big, so they live in IndexedDB rather than with the game itself.

const DB = "gb-art";
const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("assets");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("assets", mode);
    const req = fn(t.objectStore("assets"));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const saveArt = (gameId, assets) => tx("readwrite", (s) => s.put(assets, gameId));
export const loadArt = (gameId) => tx("readonly", (s) => s.get(gameId)).catch(() => undefined);
export const deleteArt = (gameId) => tx("readwrite", (s) => s.delete(gameId)).catch(() => {});
