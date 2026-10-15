// Professor Pixelwhisk: an animated SVG host with a typewriter speech bubble.
// Moods: idle, talking, thinking, laughing, working.

const SVG = `
<svg viewBox="0 0 200 220" class="prof-svg" aria-hidden="true">
  <g class="prof-body">
    <path d="M40 220 Q44 168 100 160 Q156 168 160 220Z" fill="#f4f1ea"/>
    <path d="M86 162 L100 196 L114 162Z" fill="#7dd3fc"/>
    <path d="M88 166 L100 176 L112 166 L112 182 L100 174 L88 182Z" fill="#e11d48"/>
    <path d="M70 168 L100 206 L84 220 L60 220Z M130 168 L100 206 L116 220 L140 220Z" fill="#e7e2d6"/>
    <rect x="132" y="190" width="10" height="16" rx="2" fill="#a855f7"/>
    <circle cx="137" cy="188" r="4" fill="#facc15"/>
  </g>
  <g class="prof-head">
    <g class="prof-hair" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2">
      <path d="M38 92 L14 70 L40 74 L22 44 L52 58 L50 24 L72 48 L84 14 L96 44 L112 12 L120 44 L142 18 L142 52 L172 36 L160 66 L188 66 L164 90 Z"/>
    </g>
    <ellipse cx="100" cy="100" rx="56" ry="60" fill="#fcd9b6"/>
    <ellipse cx="44" cy="104" rx="10" ry="14" fill="#f7c59f"/>
    <ellipse cx="156" cy="104" rx="10" ry="14" fill="#f7c59f"/>
    <g class="prof-brows" stroke="#e2e8f0" stroke-width="7" stroke-linecap="round" fill="none">
      <path class="brow-l" d="M58 70 Q72 58 88 68"/>
      <path class="brow-r" d="M112 66 Q130 54 144 70"/>
    </g>
    <g class="prof-eyes">
      <circle cx="74" cy="92" r="20" fill="#fff" stroke="#334155" stroke-width="5"/>
      <circle cx="128" cy="92" r="24" fill="#fff" stroke="#334155" stroke-width="5"/>
      <path d="M94 92 L104 92" stroke="#334155" stroke-width="5"/>
      <g class="prof-pupils" fill="#0f172a">
        <circle cx="76" cy="94" r="6"/>
        <circle cx="130" cy="94" r="8"/>
      </g>
      <g class="prof-lids" fill="#fcd9b6">
        <rect x="52" y="70" width="44" height="44"/>
        <rect x="102" y="66" width="52" height="52"/>
      </g>
    </g>
    <ellipse cx="101" cy="116" rx="9" ry="12" fill="#f4a988"/>
    <g class="prof-mouth">
      <ellipse cx="100" cy="142" rx="14" ry="8" fill="#7f1d1d"/>
      <ellipse cx="100" cy="146" rx="8" ry="3" fill="#fb7185"/>
    </g>
    <path class="prof-stache" d="M100 128 Q84 120 70 130 Q58 140 50 128 Q56 146 76 140 Q92 136 100 132 Q108 136 124 140 Q144 146 150 128 Q142 140 130 130 Q116 120 100 128Z" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2"/>
  </g>
  <g class="prof-sparks" fill="#facc15">
    <path d="M24 30 l6 10 -8 2 6 12"/>
    <path d="M176 24 l-6 10 8 2 -6 12"/>
    <circle cx="20" cy="120" r="3"/><circle cx="182" cy="128" r="3"/>
  </g>
  <text class="prof-think" x="168" y="40" font-size="30">❓</text>
</svg>`;

export class Professor {
  constructor(stageEl, bubbleTextEl) {
    this.stage = stageEl;
    this.text = bubbleTextEl;
    this.stage.innerHTML = SVG;
    this.typing = null;
    this.setMood("idle");
  }

  setMood(mood) {
    this.stage.dataset.mood = mood;
  }

  /** Type text into the bubble while the mouth moves. `lead` stays shown above it. Resolves when done. */
  say(text, { mood = "talking", after = "idle", lead = "" } = {}) {
    clearInterval(this.typing);
    this.setMood(mood);
    const line = document.createElement("span");
    if (lead) {
      const r = document.createElement("span");
      r.className = "reaction";
      r.textContent = lead;
      this.text.replaceChildren(r, line);
    } else {
      this.text.replaceChildren(line);
    }
    const chars = [...text];
    let i = 0;
    return new Promise((resolve) => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        line.textContent = text;
        this.setMood(after);
        return resolve();
      }
      this.typing = setInterval(() => {
        line.textContent += chars[i++] ?? "";
        if (i >= chars.length) {
          clearInterval(this.typing);
          this.setMood(after);
          resolve();
        }
      }, 22);
    });
  }

  /** Show a line instantly (for rotating status quips). */
  set(text, mood) {
    clearInterval(this.typing);
    this.text.textContent = text;
    if (mood) this.setMood(mood);
  }
}

export const GREETINGS = [
  "Ahh, a fresh test subject! Tell me your game idea, or leave it blank and let my genius run wild!",
  "Welcome to my laboratory! What game shall we unleash upon the world today?",
  "Quick, before my coffee wears off! Describe a game, any game!",
];

export const THINKING_LINES = [
  "Hmm, hmm, HMMMM…",
  "Consulting my 400 notebooks…",
  "Calculating maximum fun…",
  "Asking my pet goldfish for advice…",
];

export const BUILD_LINES = [
  "Firing up the Game-O-Tron 3000!",
  "Adding a pinch of pixels…",
  "Teaching the enemies to be rude…",
  "Tightening the jump physics with a tiny wrench…",
  "Polishing every single sprite by hand…",
  "Don't touch that lever! …okay, touch it a little.",
  "Bribing the bugs to leave…",
  "Almost there! Probably! Science is unpredictable!",
];

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
