import Anthropic from "@anthropic-ai/sdk";
import { getWorkspaceId } from "./storage.js";

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You are the engine inside "Game Builder", an app where players create small games by describing them.

Write one complete, self-contained HTML5 game as a single HTML document.

Requirements:
- Everything inline: one <style> and one <script>. No external files, libraries, fonts, images or network requests. Draw graphics with canvas, CSS, SVG or emoji.
- It runs in a sandboxed iframe on a phone. Fill the viewport (100vw x 100dvh), handle resize, and make it fully playable by touch: on-screen buttons, taps or swipes. Support keyboard as well when it fits.
- Prevent page scrolling and zooming during play (touch-action: none on the play area, preventDefault on touch events).
- Do not use localStorage, sessionStorage, cookies, alert, confirm, prompt or window.open; they are blocked in the sandbox. Keep high scores in memory.
- Start with a short title screen showing how to play, then a tap to start. Include score or progress, a game-over or win state, and a way to play again.
- Make it fun and polished: juicy feedback, sensible difficulty curve, readable text on small screens.
- Put a short, catchy game name in the <title> tag.

Reply with only the HTML document, starting with <!DOCTYPE html> and ending with </html>. No explanation before or after it.`;

const PROFESSOR_PROMPT = `You are Professor Pixelwhisk, the wildly eccentric (and slightly unhinged) mad scientist of game design inside "Game Builder", a phone app where players invent small games.

You interview the player to work out the game they want, one question at a time. Each turn you get the player's game idea and the interview so far, and you reply with:
- reaction: one or two short sentences cheekily roasting or teasing the player's latest answer, in character (dramatic gasps, silly science metaphors, playful insults like "you magnificent goblin"). Always affectionate, never mean, never about the player's real-life traits, fine for all ages. Empty on the very first turn: greet the player and react to their idea instead.
- question: the next question, one playful sentence, built on what they already said so it is clearly a follow-up and not a generic survey. Cover what matters most for building this specific game: hero, setting, goal, main danger or twist, controls feel, difficulty, visual style. Never re-ask something already decided.
- options: for most questions, 3 or 4 short answers (a few words each, with an emoji), each leading to a genuinely different game; the player can always type their own answer instead. When the player's own imagination matters more than a pick from a list (naming the hero, describing a special power, a secret, a villain's evil plan), ask an open question instead and leave options empty. Include at least one open question in every interview.
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
  const client = makeClient(apiKey);
  const transcript = answers.length
    ? answers
        .map((a, i) => (a.final ? `Final details from player: ${a.answer}` : `Q${i + 1}: ${a.question}\nPlayer: ${a.answer}`))
        .join("\n\n")
    : "(No questions asked yet. This is your first turn.)";

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
            content: `Player's game idea: ${idea || "None yet. They want you to surprise them."}\n\nInterview so far:\n${transcript}`,
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
    const turn = JSON.parse(text);
    return { ...turn, options: (turn.options ?? []).slice(0, 4) };
  } catch {
    throw new GenerationError("The professor's notes came back garbled. Try again.");
  }
}

/**
 * Ask Claude for a game. Pass `currentHtml` to change an existing game.
 * `onProgress(chars)` is called as the HTML streams in.
 */
export async function generateGame({ apiKey, prompt, currentHtml, signal, onProgress, onRetry }) {
  const userContent = currentHtml
    ? `Here is the current game:\n\n${currentHtml}\n\nChange it like this: ${prompt}\n\nReturn the full updated HTML document.`
    : `Make this game: ${prompt}`;

  // Phones drop long connections (screen off, app switched, network change).
  // When that happens, wait until the app is visible again and start over.
  let message;
  for (let attempt = 0; ; attempt++) {
    try {
      message = await streamOnce(apiKey, userContent, signal, onProgress);
      break;
    } catch (err) {
      if (!isDroppedConnection(err) || signal?.aborted || attempt >= MAX_RETRIES) {
        throw new GenerationError(describeApiError(err));
      }
      await whenVisible(signal);
      if (signal?.aborted) throw new GenerationError("Cancelled.");
      onRetry?.(attempt + 1);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (message.stop_reason === "refusal") {
    throw new GenerationError("Claude declined to make this one. Try describing the game differently.");
  }

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const html = extractHtml(text);
  if (!html) {
    if (message.stop_reason === "max_tokens") {
      throw new GenerationError("The game got too big and was cut off. Try a simpler idea.");
    }
    throw new GenerationError("Claude didn't return a playable game. Try again.");
  }

  return { html, title: extractTitle(html) };
}

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

async function streamOnce(apiKey, userContent, signal, onProgress) {
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
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: attempt.signal, maxRetries: 0 },
    );
    let received = 0;
    onProgress?.(0);
    stream.on("text", (delta) => {
      received += delta.length;
      onProgress?.(received);
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
