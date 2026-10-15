// Google Gemini REST API: shared request helper, plus the text model that runs the
// Professor's interview, the game plan and the art list when a Gemini key is set.

const API = "https://generativelanguage.googleapis.com/v1beta";
const PREFERRED_TEXT_MODEL = "gemini-3.8-flash";

export async function gemini(key, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key, ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(res.status === 400 && /api key/i.test(msg) ? "Gemini rejected the API key." : `Gemini: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

let modelsPromise = null;

/** Every model this key can call with generateContent (names change often, so ask). */
export function listModels(key) {
  modelsPromise ??= gemini(key, "models?pageSize=200").then(({ models = [] }) =>
    models.filter((m) => m.supportedGenerationMethods?.includes("generateContent")),
  );
  modelsPromise.catch(() => (modelsPromise = null));
  return modelsPromise;
}

const version = (name) => parseFloat(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || "0");

/** Gemini 3.8 Flash when this key has it, otherwise the newest regular Flash model. */
export async function textModel(key) {
  const models = (await listModels(key)).map((m) => m.name);
  const exact = models.find((n) => n === `models/${PREFERRED_TEXT_MODEL}`);
  if (exact) return exact;
  const flash = models
    .filter((n) => /gemini-[\d.]+-flash/.test(n) && !/lite|image|tts|live|audio|embed/i.test(n))
    .sort((a, b) => version(b) - version(a) || /preview|exp/.test(a) - /preview|exp/.test(b));
  if (!flash[0]) throw new Error("This Gemini key has no Flash text model available.");
  return flash[0];
}

/**
 * One text request at medium thinking. With `schema`, the reply is parsed JSON.
 * If the model rejects the thinking or schema settings, retries once with plain JSON mode.
 */
export async function geminiText({ key, system, user, schema, signal }) {
  const model = await textModel(key);
  const request = (generationConfig) =>
    gemini(key, `${model}:generateContent`, {
      method: "POST",
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
    });
  const json = schema ? { responseMimeType: "application/json" } : {};
  let body;
  try {
    body = await request({ ...json, ...(schema && { responseJsonSchema: schema }), thinkingConfig: { thinkingLevel: "medium" } });
  } catch (err) {
    if (err.status !== 400 || /api key/i.test(err.message)) throw err;
    body = await request(json);
  }
  const candidate = body.candidates?.[0];
  if (candidate?.finishReason === "SAFETY" || body.promptFeedback?.blockReason) {
    throw new Error("Gemini refused that one. Try a different idea.");
  }
  const text = (candidate?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (!text) throw new Error("Gemini sent back an empty answer.");
  if (!schema) return text.trim();
  return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
}
