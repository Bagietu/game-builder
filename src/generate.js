import Anthropic from "@anthropic-ai/sdk";
import { getWorkspaceId, getGeminiKey } from "./storage.js";
import { geminiText } from "./gemini.js";

const MODEL = "claude-opus-5-5";

/** The app hosts its own copy of Phaser; games reference it with exactly this tag. */
export const PHASER_URL = "https://bagietu.github.io/game-builder/vendor/phaser.min.js";
export const PHASER_TAG = `<script src="${PHASER_URL}"></script>`;

const GAME_RULES = `Technical rules:
- One complete HTML document. Use Phaser 3.90 as the game engine, loaded with exactly this tag in <head>: ${PHASER_TAG}
  No other external files, libraries, fonts, images or network requests. Make all graphics in code: Phaser Graphics + generateTexture, shapes, gradients, emoji or text, particle emitters.
- It runs in a sandboxed iframe on a phone. Fill the viewport (Phaser Scale.RESIZE or FIT with autoCenter), handle resize, and make it fully playable by touch: on-screen buttons, taps, drags or swipes sized for thumbs. Support keyboard as well when it fits.
- Prevent page scrolling and zooming (touch-action: none, margin 0, overflow hidden).
- Do not use localStorage, sessionStorage, cookies, alert, confirm, prompt or window.open; they are blocked. Keep high scores in memory. Sound, if any, via Web Audio started on the first tap.
- Organise the code in Phaser scenes (e.g. Boot/Title, Game, UI, GameOver) and small classes. Avoid runtime errors: guard against undefined objects, destroy timers and listeners on scene shutdown.
- Put a short, catchy game name in the <title> tag.`;

const BUILD_PROMPT = `You are the lead developer inside "Game Builder", an app where players create games on their phone by describing them. You get the player's brief and a design plan; build that game in full.

Aim high: this should feel like a real, polished mobile game, not a tech demo. Multiple levels or escalating waves, enemies or obstacles with distinct behaviours, power-ups or upgrades, a clear goal, a title screen that explains the controls, score and progress HUD, game-over and win screens with play-again, juicy feedback (tweens, particles, screen shake, hit flashes) and a fair difficulty curve. Follow the plan, and improve on it where it makes the game more fun.

${GAME_RULES}

Reply with only the HTML document, starting with <!DOCTYPE html> and ending with </html>. No explanation before or after it.`;

const PLAN_PROMPT = `You are the game designer inside "Game Builder", a phone app where players create games by describing them. Turn the player's brief into a tight design plan for a Phaser 3 mobile game that a developer will build in one HTML file with code-drawn graphics.

Cover, as short markdown bullets: game name; core loop; touch controls; the player character and abilities; enemies/obstacles and how each behaves; progression (levels, waves, upgrades, bosses); scoring, win and lose conditions; screens; juice and feel; art direction using shapes, gradients, emoji and particles. Be concrete and ambitious but buildable. Keep it under 350 words. Reply with only the plan.`;

const EDIT_PROMPT = `You are the developer inside "Game Builder", a phone app where players create games. You get an existing game (one HTML file) and a change to make: either the player's request or bugs found by an automatic playtest. Make the change well and keep everything else working.

${GAME_RULES}

Reply with edits in this exact format, as many blocks as needed, and nothing else:
<<<<<<< SEARCH
(exact lines copied from the current file, enough to be unique)
=======
(the replacement lines)
>>>>>>> REPLACE

Each SEARCH must match the current file exactly, including indentation. If the change touches most of the file, reply instead with the full new HTML document, starting with <!DOCTYPE html> and ending with </html>.`;

const PROFESSOR_PROMPT = `You are Professor Pixelwhisk, the wildly eccentric (and slightly unhinged) mad scientist of game design inside "Game Builder", a phone app where players invent small games.

You interview the player to work out the game they want, one question at a time. Each turn you get the player's game idea and the interview so far, and you reply with:
- reaction: one or two short sentences cheekily roasting or teasing the player's latest answer, in character (dramatic gasps, silly science metaphors, playful insults like "you magnificent goblin"). Always affectionate, never mean, never about the player's real-life traits, fine for all ages. Empty on the very first turn: greet the player and react to their idea instead.
- question: the next question, one playful sentence, built on what they already said so it is clearly a follow-up and not a generic survey. Ask about the game itself, in roughly this order of importance: what kind of game it is and how it plays moment to moment (the core action), the goal and how you win or lose, what makes it get harder or more interesting over time (levels, waves, upgrades, scoring, combos), the main obstacles or enemies and how they behave, the controls feel, how long a round lasts, and the difficulty. At most one question in the whole interview may be about looks or story (hero's appearance, names, backstory, visual style), and only after the gameplay is clear; otherwise invent those details yourself. Never re-ask something already decided.
- options: for most questions, 3 or 4 short answers (a few words each, with an emoji), each leading to a genuinely different way to play; the player can always type their own answer instead. When the player's own imagination matters more than a pick from a list (a special mechanic, a power-up, a boss's attack pattern, a twist in the rules), ask an open question instead and leave options empty. Include at least one open question in every interview.
- ready: true once you know enough to build a great game (usually after 3 to 6 answers). Then set question to a triumphant one-line announcement that you're about to start the machine, and options to an empty list. The player then gets a chance to add final details.

When the interview ends with "Final details" from the player, read them carefully. If they add something worth clarifying or open up a fun new direction, react and ask 1 to 3 more follow-up questions (ready false). Otherwise react and set ready to true.

Keep every line short enough to read on a phone in a speech bubble.`;

const PROFESSOR_SCHEMA = {
  type: "object",
  properties: {
    reaction: { type: "string" },
    question: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          emoji: { type: "string" },
          label: { type: "string" },
        },
        required: ["emoji", "label"],
        additionalProperties: false,
      },
    },
    ready: { type: "boolean" },
  },
  required: ["reaction", "question", "options", "ready"],
  additionalProperties: false,
};

export class GenerationError extends Error {}

/** Design work (interview, plan, art list) goes to Gemini when its key is set; Claude covers if Gemini fails. */
async function viaGemini(signal, ask, fallback) {
  const key = getGeminiKey();
  if (!key) return fallback();
  try {
    return await ask(key);
  } catch (err) {
    if (signal?.aborted) throw new GenerationError("Cancelled.");
    console.warn("Gemini failed, using Claude instead:", err);
    return fallback();
  }
}

// Keys that aren't tied to one workspace must name the workspace on every request.
function makeClient(apiKey, onBytes) {
  const workspaceId = getWorkspaceId();
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    // Tap the raw response so keep-alive pings (which the SDK hides) count as signs of life.
    fetch: onBytes ? (url, init) => fetch(url, init).then((res) => tapBody(res, onBytes)) : undefined,
  });
}

function tapBody(res, onBytes) {
  if (!res.body) return res;
  const tap = new TransformStream({
    transform(chunk, controller) {
      onBytes();
      controller.enqueue(chunk);
    },
  });
  return new Response(res.body.pipeThrough(tap), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * One turn of the professor's interview. `answers` is [{ question, answer }] so far.
 * Returns { reaction, question, options, ready }.
 */
export async function professorTurn({ apiKey, idea, answers, signal }) {
  const transcript = answers.length
    ? answers
        .map((a, i) => (a.final ? `Final details from player: ${a.answer}` : `Q${i + 1}: ${a.question}\nPlayer: ${a.answer}`))
        .join("\n\n")
    : "(No questions asked yet. This is your first turn.)";
  const user = `Player's game idea: ${idea || "None yet. They want you to surprise them."}\n\nInterview so far:\n${transcript}`;
  const tidy = (turn) => ({ ...turn, options: (turn.options ?? []).slice(0, 4) });
  return viaGemini(
    signal,
    async (key) => tidy(await geminiText({ key, system: PROFESSOR_PROMPT, user, schema: PROFESSOR_SCHEMA, signal })),
    () => professorWithClaude(apiKey, user, signal).then(tidy),
  );
}

async function professorWithClaude(apiKey, user, signal) {
  const client = makeClient(apiKey);
  let message;
  try {
    message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: PROFESSOR_SCHEMA } },
        system: PROFESSOR_PROMPT,
        messages: [
          {
            role: "user",
            content: user,
          },
        ],
      },
      { signal },
    );
  } catch (err) {
    throw new GenerationError(describeApiError(err));
  }

  if (message.stop_reason === "refusal") {
    throw new GenerationError("The professor refuses to work on that one. Try a different idea.");
  }
  const text = message.content.find((block) => block.type === "text")?.text;
  try {
    return JSON.parse(text);
  } catch {
    throw new GenerationError("The professor's notes came back garbled. Try again.");
  }
}

/** Run one streamed request, starting over if the phone drops the connection. */
// Below this much text, starting over is cheaper than asking Claude to pick up mid-file.
const MIN_RESUME = 1500;
// How many back-to-back replies one game may take when it outgrows a single reply.
const MAX_PARTS = 4;

/** Ask Claude to carry on a document that got cut off, instead of writing it again. */
function continuation(content, soFar) {
  return `${content}\n\nYou already started writing your reply and got cut off. Everything written so far is between the markers below.\n<<<WRITTEN SO FAR>>>\n${soFar}\n<<<END>>>\n\nContinue from exactly where it stops: reply with only the rest, starting with the very next characters. Do not repeat anything already written and add no explanation.`;
}

/** Join a cut-off text and its continuation, dropping any overlap Claude repeated. */
export function stitch(soFar, rest) {
  if (/^\s*(```\w*\s*)?<!DOCTYPE/i.test(rest)) return rest; // it started over from the top
  rest = rest.replace(/^```\w*\n/, "");
  for (let n = Math.min(400, soFar.length, rest.length); n >= 20; n--) {
    if (soFar.endsWith(rest.slice(0, n))) return soFar + rest.slice(n);
  }
  return soFar + rest;
}

/**
 * Run one streamed request, retrying if the phone drops the connection.
 * With `request.resumable`, a retry continues from the text already written (and from
 * `request.resume`, text saved by an earlier attempt) instead of starting over.
 * `onPartial` gets everything written so far, for saving.
 */
async function streamWithRetries(apiKey, request, { signal, onProgress, onThinking, onRetry, onPartial, onContinue }) {
  let kept = request.resumable ? request.resume || "" : "";
  let parts = 1;
  for (let attempt = 0; ; attempt++) {
    const prefix = kept.length >= MIN_RESUME ? kept : "";
    const req = prefix ? { ...request, content: continuation(request.content, prefix) } : request;
    let latest = "";
    const progress = (n, text) => {
      latest = text;
      onProgress?.(prefix.length + n, prefix + text);
      onPartial?.(prefix + text);
    };
    try {
      const message = await streamOnce(apiKey, req, signal, progress, onThinking);
      if (message.stop_reason === "refusal") {
        throw new GenerationError("Claude declined to make this one. Try describing the game differently.");
      }
      const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const whole = prefix ? stitch(prefix, text) : text;
      // Hit the length limit mid-file: ask for the rest instead of failing (big games need several parts).
      if (request.resumable && message.stop_reason === "max_tokens" && text.length > 500 && parts < MAX_PARTS) {
        kept = whole;
        onPartial?.(kept);
        onContinue?.(++parts);
        attempt--; // not a connection retry
        continue;
      }
      return { message, text: whole };
    } catch (err) {
      if (request.resumable && latest) {
        kept = prefix ? stitch(prefix, latest) : latest;
        onPartial?.(kept);
      }
      if (err instanceof GenerationError) throw err;
      if (!isDroppedConnection(err) || signal?.aborted || attempt >= MAX_RETRIES) {
        throw new GenerationError(describeApiError(err));
      }
      await whenVisible(signal);
      if (signal?.aborted) throw new GenerationError("Cancelled.");
      onRetry?.(attempt + 1);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Step 1: a short design plan for the game. */
export async function planGame({ apiKey, prompt, ...callbacks }) {
  const content = `Player's brief:\n${prompt}`;
  return viaGemini(
    callbacks.signal,
    async (key) => {
      const plan = await geminiText({ key, system: PLAN_PROMPT, user: content, signal: callbacks.signal });
      callbacks.onProgress?.(plan.length, plan);
      return plan;
    },
    async () => {
      const { text } = await streamWithRetries(apiKey, { system: PLAN_PROMPT, effort: "low", maxTokens: 8000, content }, callbacks);
      return text.trim();
    },
  );
}

const ART_SCHEMA = {
  type: "object",
  properties: {
    style: { type: "string" },
    assets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          kind: { type: "string", enum: ["sprite", "background"] },
          description: { type: "string" },
        },
        required: ["key", "kind", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["style", "assets"],
  additionalProperties: false,
};

/** From the plan, the images worth having drawn: { style, assets: [{ key, kind, description }] }. */
const ART_PROMPT = `An image model will draw art for a 2D phone game from this design plan. Choose up to 6 images that matter most: the player character, main enemies or obstacles, key pickups, and at most one background. Use short lowercase keys like "hero" or "slime". Each description says exactly what to draw (look, colors, pose) for a single image. "style" is one shared art style line, e.g. "bright cartoon, thick dark outlines, soft shading". Repeated or tiny things (bullets, particles, tiles, UI) are drawn in code, so leave them out.`;

export async function listArt({ apiKey, plan, signal }) {
  const parsed = await viaGemini(
    signal,
    (key) => geminiText({ key, system: ART_PROMPT, user: plan, schema: ART_SCHEMA, signal }),
    () => artWithClaude(apiKey, plan, signal),
  );
  const seen = new Set();
  const assets = (parsed.assets || [])
    .filter((a) => a?.key && a.description)
    .map((a) => ({ ...a, kind: a.kind === "background" ? "background" : "sprite", key: a.key.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))
    .filter((a) => !seen.has(a.key) && seen.add(a.key))
    .slice(0, 6);
  return { style: parsed.style || "colorful cartoon", assets };
}

async function artWithClaude(apiKey, plan, signal) {
  const client = makeClient(apiKey);
  try {
    const message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: ART_SCHEMA } },
        system: ART_PROMPT,
        messages: [{ role: "user", content: plan }],
      },
      { signal },
    );
    return JSON.parse(message.content.find((b) => b.type === "text")?.text || "{}");
  } catch (err) {
    throw new GenerationError(describeApiError(err));
  }
}

/** Tells the developer which drawn images exist and how to load them. */
export function artNote(assets) {
  const entries = Object.entries(assets || {});
  if (!entries.length) return "";
  const lines = entries.map(([k, a]) => `- "${k}" (${a.kind}, ${a.w}x${a.h}px${a.kind === "sprite" ? ", transparent PNG" : ""}): ${a.description}`);
  return `Drawn images are available. At runtime window.GAME_ASSETS maps each key to an image data URL. Load them in a Phaser preload() with this.load.image(key, window.GAME_ASSETS[key]) and use them for these things instead of drawing them in code; scale with setDisplaySize/setScale to fit the game. Flip sprites with setFlipX to face left. Draw everything else in code. If window.GAME_ASSETS or a key is missing, fall back to code-drawn graphics.\n${lines.join("\n")}`;
}

/** Step 2: build the whole game from the brief and plan. */
export async function generateGame({ apiKey, prompt, plan, assets, resume, ...callbacks }) {
  const art = artNote(assets);
  const content = [`Player's brief:\n${prompt}`, plan && `Design plan:\n${plan}`, art].filter(Boolean).join("\n\n");
  const { message, text } = await streamWithRetries(
    apiKey,
    { system: BUILD_PROMPT, effort: "high", maxTokens: 128000, content, resumable: true, resume },
    callbacks,
  );
  const html = extractHtml(text);
  if (!html) {
    if (message.stop_reason === "max_tokens") {
      throw new GenerationError("The game got too big even in several parts. Tap Continue to keep going, or try a smaller idea.");
    }
    throw new GenerationError("Claude didn't return a playable game. Try again.");
  }
  return { html, title: extractTitle(html) };
}

/**
 * Change an existing game: a player's request, or bugs from the playtest.
 * Claude sends small search/replace edits, so big games stay cheap and fast to change.
 */
export async function editGame({ apiKey, html, change, assets, ...callbacks }) {
  const art = artNote(assets);
  const content = `Current game:\n\n${html}\n\n${art ? art + "\n\n" : ""}Change to make:\n${change}`;
  const { message, text } = await streamWithRetries(
    apiKey,
    { system: EDIT_PROMPT, effort: "medium", maxTokens: 128000, content },
    callbacks,
  );
  const full = extractHtml(text);
  if (full && !text.includes("<<<<<<< SEARCH")) return { html: full, title: extractTitle(full) };

  const edited = applyEdits(html, text);
  if (!edited) {
    if (message.stop_reason === "max_tokens") throw new GenerationError("The change got too big and was cut off. Try a smaller change.");
    throw new GenerationError("Claude's changes didn't fit the game's code. Try again.");
  }
  return { html: edited, title: extractTitle(edited) };
}

/** Apply SEARCH/REPLACE blocks. Returns null if there are none or one doesn't match. */
export function applyEdits(html, text) {
  const blocks = [...text.matchAll(/<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g)];
  if (!blocks.length) return null;
  let out = html;
  for (const [, search, replace] of blocks) {
    let at = out.indexOf(search);
    let find = search;
    if (at === -1) {
      // Forgive differences in trailing whitespace on each line.
      const loose = new RegExp(search.split("\n").map((l) => escapeRegExp(l.trimEnd()) + "[ \\t]*").join("\\n"));
      const m = out.match(loose);
      if (!m) return null;
      at = m.index;
      find = m[0];
    }
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function extractHtml(text) {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + "</html>".length);
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "";
}

const MAX_RETRIES = 4;

// The API sends a keep-alive ping every few seconds, so this much silence means
// the connection died without telling us (common after a phone's screen sleeps).
const STALL_MS = 45_000;

class StallError extends Error {}

async function streamOnce(apiKey, request, signal, onProgress, onThinking) {
  const attempt = new AbortController();
  const stopAttempt = () => attempt.abort();
  signal?.addEventListener("abort", stopAttempt);
  let lastByte = Date.now();
  let stalled = false;
  const checkStall = () => {
    if (Date.now() - lastByte > STALL_MS) {
      stalled = true;
      attempt.abort();
    }
  };
  const watchdog = setInterval(checkStall, 5000);
  // Timers freeze while the screen is off, so check the moment the app comes back.
  const onVisible = () => document.visibilityState === "visible" && checkStall();
  document.addEventListener("visibilitychange", onVisible);

  try {
    const client = makeClient(apiKey, () => (lastByte = Date.now()));
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: request.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: request.effort },
        system: request.system,
        messages: [{ role: "user", content: request.content }],
      },
      { signal: attempt.signal, maxRetries: 0 },
    );
    let written = "";
    let thought = "";
    onProgress?.(0, "");
    onThinking?.("");
    stream.on("thinking", (delta) => {
      thought += delta;
      onThinking?.(thought);
    });
    stream.on("text", (delta) => {
      written += delta;
      onProgress?.(written.length, written);
    });
    return await stream.finalMessage();
  } catch (err) {
    if (stalled && !signal?.aborted) throw new StallError("no answer from the API for a while");
    throw err;
  } finally {
    clearInterval(watchdog);
    document.removeEventListener("visibilitychange", onVisible);
    signal?.removeEventListener("abort", stopAttempt);
  }
}

/** The connection broke (as opposed to the API saying no). */
function isDroppedConnection(err) {
  if (err instanceof StallError) return true;
  if (err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) return [500, 502, 503, 504, 529].includes(err.status) || err.status == null;
  return /network|fetch|load failed|terminated|aborted|connection|stream ended/i.test(String(err?.message ?? err));
}

function whenVisible(signal) {
  if (typeof document === "undefined" || document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (document.visibilityState !== "visible" && !signal?.aborted) return;
      document.removeEventListener("visibilitychange", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal?.addEventListener("abort", done);
  });
}

function describeApiError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic's API. Check your connection.";
  if (err instanceof Anthropic.APIError) {
    if (err.status === 400 && /anthropic-workspace-id/i.test(err.message)) {
      return "This API key needs a workspace. Open Settings and add your Workspace ID (it starts with wrkspc_).";
    }
    if (err.status === 400 && /credit balance/i.test(err.message)) {
      return "Your Anthropic account is out of credits.";
    }
    return `API error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  }
  if (isDroppedConnection(err)) {
    return `The connection dropped while building (${err?.message || err}). Keep the app open with the screen on, then try again.`;
  }
  return err?.message || String(err);
}
