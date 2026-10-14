import Anthropic from "@anthropic-ai/sdk";

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

const QUIZ_PROMPT = `You are the hilarious game-show host inside "Game Builder", an app where players create small phone games by describing them.

Before the game gets built, you ask the player 4 short, funny multiple-choice questions that decide the game's most important features: things like the hero, the setting, the goal, the main danger or twist, the difficulty, or the visual style. Pick the 4 that matter most for this particular game idea, and skip anything the player already decided.

Each question is one playful sentence (puns, silly stakes and dramatic flair welcome, but keep it clear what it's really asking). Each has 3 or 4 answers of a few words each, with a fitting emoji, and every answer must lead to a genuinely different game. Keep it friendly for all ages.`;

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
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
        },
        required: ["question", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export class GenerationError extends Error {}

/** Ask Claude for a few funny questions that pin down the game's features. */
export async function askQuestions({ apiKey, prompt, signal }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const idea = prompt || "No idea yet. Surprise me!";

  let message;
  try {
    message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: QUIZ_SCHEMA } },
        system: QUIZ_PROMPT,
        messages: [{ role: "user", content: `The player's game idea: ${idea}` }],
      },
      { signal },
    );
  } catch (err) {
    throw new GenerationError(describeApiError(err));
  }

  if (message.stop_reason === "refusal") {
    throw new GenerationError("Claude declined this idea. Try describing the game differently.");
  }
  const text = message.content.find((block) => block.type === "text")?.text;
  try {
    const { questions } = JSON.parse(text);
    return questions.filter((q) => q.options?.length >= 2).slice(0, 5);
  } catch {
    throw new GenerationError("Claude's questions came back garbled. Try again.");
  }
}

/**
 * Ask Claude for a game. Pass `currentHtml` to change an existing game.
 * `onProgress(chars)` is called as the HTML streams in.
 */
export async function generateGame({ apiKey, prompt, currentHtml, signal, onProgress }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const userContent = currentHtml
    ? `Here is the current game:\n\n${currentHtml}\n\nChange it like this: ${prompt}\n\nReturn the full updated HTML document.`
    : `Make this game: ${prompt}`;

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
    { signal },
  );

  let received = 0;
  stream.on("text", (delta) => {
    received += delta.length;
    onProgress?.(received);
  });

  let message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    throw new GenerationError(describeApiError(err));
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

function describeApiError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use this model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a moment and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic's API. Check your connection.";
  if (err instanceof Anthropic.APIError) {
    if (err.status === 400 && /credit balance/i.test(err.message)) {
      return "Your Anthropic account is out of credits.";
    }
    return `API error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  }
  return err?.message || String(err);
}
