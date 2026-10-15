import { professorTurn, planGame, listArt, generateGame, editGame, GenerationError } from "./generate.js";
import { drawAssets, saveArt, loadArt, deleteArt } from "./art.js";
import { playtest, withPhaser } from "./playtest.js";
import { unlockApp, adoptVault } from "./lock.js";
import { fetchVault, openVault, sealVault } from "./vault.js";
import { saveAsFile, publishGame, checkPublished, gameLinks, commitFile } from "./install.js";
import { Professor, GREETINGS, THINKING_LINES, BUILD_LINES, pick } from "./professor.js";
import { getApiKey, setApiKey, getWorkspaceId, setWorkspaceId, getGithubToken, setGithubToken, getPendingBuild, setPendingBuild, getGeminiKey, setGeminiKey, listGames, saveGame, deleteGame } from "./storage.js";

const $ = (id) => document.getElementById(id);

const IDEAS = [
  "Flappy-style game with a jetpack hamster",
  "Snake that grows when it eats stars",
  "Breakout with exploding bricks",
  "Endless runner on a neon highway",
  "Whack-a-mole with aliens",
  "Space shooter with asteroid waves",
];

let currentGame = null;
let abort = null;
const MAX_QUESTIONS = 10; // safety cap; the professor usually stops sooner
const FINAL_QUESTION = "Any last details before I pull the lever?";
const prof = new Professor($("professor"), $("bubbleText"));

// ---------- Builder ----------

function renderIdeas() {
  const box = $("ideas");
  for (const idea of IDEAS) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = idea;
    chip.addEventListener("click", () => {
      $("prompt").value = idea;
      $("prompt").focus();
    });
    box.append(chip);
  }
}

function requireKey() {
  const key = getApiKey();
  if (!key) {
    prof.say("My machine has no fuel! The admin needs to add an API key in ⚙️ Settings.", { mood: "thinking" });
    openSettings({ admin: true });
  }
  return key;
}

// Step 1: the professor interviews the player, one adaptive question at a time.
let interview = null;

async function start() {
  const apiKey = requireKey();
  if (!apiKey) return;
  $("error").hidden = true;
  interview = { idea: $("prompt").value.trim(), answers: [] };
  $("form").hidden = true;
  nextTurn();
}

async function nextTurn() {
  const session = interview;
  $("quiz").hidden = true;
  $("error").hidden = true;
  prof.set(pick(THINKING_LINES), "thinking");
  setBusy(true, $("buildBtn"), $("progress"));
  $("progressText").textContent = "The professor is thinking…";
  abort = new AbortController();
  try {
    const turn = await professorTurn({
      apiKey: getApiKey(),
      idea: session.idea,
      answers: session.answers,
      signal: abort.signal,
    });
    abort = null;
    setBusy(false, $("buildBtn"), $("progress"));
    if (interview !== session) return;

    const asked = session.answers.filter((a) => !a.final).length;
    const justAddedDetails = session.answers.at(-1)?.final;
    if (turn.reaction) await sayReaction(turn.reaction);
    if (interview !== session) return;
    if (asked >= MAX_QUESTIONS || (turn.ready && justAddedDetails)) {
      await prof.say(turn.ready ? turn.question : "Enough science! To the machine!", { after: "working" });
      return build(session.idea, session.answers);
    }
    if (turn.ready) return showFinalDetails(session, turn);
    showQuestion(session, turn);
  } catch (err) {
    abort = null;
    setBusy(false, $("buildBtn"), $("progress"));
    if (interview !== session) return;
    prof.set("Blast! My machine sputtered. Try again?", "idle");
    showError($("error"), err);
    $("quiz").hidden = true;
    $("form").hidden = false;
    interview = null;
  }
}

async function sayReaction(reaction) {
  await prof.say(reaction, { mood: "laughing", after: "laughing" });
  await new Promise((r) => setTimeout(r, 900));
}

function showQuestion(session, turn) {
  // Keep the roast visible above the question.
  prof.say(turn.question, { lead: turn.reaction });

  const number = session.answers.filter((a) => !a.final).length + 1;
  const open = turn.options.length === 0;
  $("quizCount").textContent = open ? `Question ${number} · your own words` : `Question ${number}`;
  $("answerInput").placeholder = open ? "Type your answer…" : "…or write your own answer";
  $("answerForm").hidden = false;
  $("finalDetails").hidden = true;
  $("skipQuiz").hidden = false;
  const box = $("quizOptions");
  box.hidden = open;
  box.replaceChildren();
  const answer = (text) => {
    if (interview !== session) return;
    session.answers.push({ question: turn.question, answer: text });
    nextTurn();
  };
  for (const option of turn.options) {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    const emoji = document.createElement("span");
    emoji.className = "emoji";
    emoji.textContent = option.emoji;
    const label = document.createElement("span");
    label.textContent = option.label;
    btn.append(emoji, label);
    btn.addEventListener("click", () => answer(option.label));
    box.append(btn);
  }
  $("answerForm").onsubmit = (e) => {
    e.preventDefault();
    const text = $("answerInput").value.trim();
    if (!text) return $("answerInput").focus();
    $("answerInput").value = "";
    answer(text);
  };
  $("skipQuiz").onclick = () => {
    if (interview !== session) return;
    prof.say("Impatient! I love it. To the machine!", { after: "working" });
    build(session.idea, session.answers);
  };
  revealQuiz();
  if (open) $("answerInput").focus({ preventScroll: true });
}

// The professor is ready: let the player add anything else before building.
function showFinalDetails(session, turn) {
  prof.say(`${turn.question} ${FINAL_QUESTION}`, { lead: turn.reaction });
  $("quizCount").textContent = "Final touches (optional)";
  $("quizOptions").hidden = true;
  $("answerForm").hidden = true;
  $("skipQuiz").hidden = true;
  $("finalDetails").hidden = false;
  $("detailsInput").value = "";
  $("finalBuildBtn").onclick = () => {
    if (interview !== session) return;
    const details = $("detailsInput").value.trim();
    if (!details) {
      prof.say("No notes? Pure confidence! FIRE UP THE MACHINE!", { after: "working" });
      return build(session.idea, session.answers);
    }
    session.answers.push({ question: FINAL_QUESTION, answer: details, final: true });
    nextTurn();
  };
  revealQuiz();
}

function revealQuiz() {
  $("quiz").hidden = false;
  // Restart the pop-in animation for each new question.
  $("quiz").style.animation = "none";
  void $("quiz").offsetWidth;
  $("quiz").style.animation = "";
}

function composePrompt(idea, answers) {
  const base = idea || "Surprise me with a fun game.";
  if (answers.length === 0) return base;
  const picks = answers
    .map((a) => (a.final ? `- Extra details from the player: ${a.answer}` : `- ${a.question} → ${a.answer}`))
    .join("\n");
  return `${base}\n\nThe player decided these details in an interview:\n${picks}`;
}

// Step 2: build the game from the idea plus the player's answers.
async function build(idea, answers, saved = null) {
  interview = null;
  $("resumeBox").hidden = true;
  $("quiz").hidden = true;
  $("form").hidden = true;
  const apiKey = requireKey();
  if (!apiKey) return resetBuilder();
  const prompt = composePrompt(idea, answers);
  const summary = [idea, ...answers.map((a) => a.answer)].filter(Boolean).join(" · ") || "Surprise game";

  setBusy(true, $("buildBtn"), $("progress"), $("error"));
  const quips = setInterval(() => prof.set(pick(BUILD_LINES), "working"), 3500);
  setTimeout(() => prof.set(pick(BUILD_LINES), "working"), 1500);
  abort = new AbortController();
  const signal = abort.signal;
  const ticker = progressTicker($("progressText"), $("buildLive"));
  const callbacks = liveCallbacks(ticker, () =>
    prof.set("The connection fizzled! Rewiring the doohickey and starting over…", "working"),
  );
  // Every finished step (and the code written so far) is saved as it happens, so a build
  // that dies (page reload, lost connection, out of credits) can continue where it stopped.
  const job = saved ?? { kind: "build", idea, answers, id: crypto.randomUUID() };
  const keep = (patch) => setPendingBuild(Object.assign(job, patch, { at: Date.now() }));
  keep({ error: undefined });
  let lastSave = 0;
  try {
    const geminiKey = getGeminiKey();
    const steps = geminiKey ? 4 : 3;
    let step = 1;
    const label = (name) => `Step ${step++}/${steps} · ${name}`;
    const id = job.id;

    ticker.stage(label("Planning"), 0, 8, 1500, "📝 Game plan");
    if (job.plan) ticker.update(job.plan.length, job.plan);
    else keep({ plan: await planGame({ apiKey, prompt, signal, ...callbacks }) });
    const { plan } = job;

    let assets = {};
    if (job.artDone) {
      assets = (await loadArt(id)) || {};
    } else if (geminiKey) {
      ticker.stage(label("Drawing art"), 8, 20, 0, null, { art: true });
      prof.set("Summoning my artist friend from the Gemini dimension…", "working");
      try {
        const { style, assets: wanted } = await listArt({ apiKey, plan, signal });
        ticker.artCount(wanted.length);
        assets = await drawAssets({ key: geminiKey, assets: wanted, style, signal, onAsset: (k, a) => ticker.art(k, a) });
        await saveArt(id, assets);
      } catch (err) {
        if (signal.aborted) throw new GenerationError("Cancelled.");
        assets = {};
        prof.set(`The artist fainted (${err.message}). I'll draw everything myself!`, "working");
      }
      keep({ artDone: true });
    }
    if (job.artDone && step === 2 && geminiKey) step++; // art came from the saved build

    const buildFrom = geminiKey ? 20 : 8;
    ticker.stage(label("Building"), buildFrom, 82, 40_000, "⌨️ Your game, being written");
    if (job.partial) prof.set("Picking up right where my pen stopped!", "working");
    const built = await generateGame({
      apiKey,
      prompt,
      plan,
      assets,
      signal,
      resume: job.partial,
      ...callbacks,
      onPartial: (text) => {
        job.partial = text;
        if (Date.now() - lastSave > 2000) (lastSave = Date.now()), keep({});
      },
    });
    let game = { id, title: built.title || summary, prompt, plan, html: built.html, history: [summary] };
    saveGame(game); // keep the paid-for build even if the page goes away during testing
    setPendingBuild(null);
    renderGallery();

    const tested = await playtestAndFix({ apiKey, html: game.html, assets, ticker, signal, rounds: 2, from: 82, step: `Step ${step}/${steps}` });
    game = { ...game, html: tested.html };
    saveGame(game);
    $("prompt").value = "";
    renderGallery();
    clearInterval(quips);
    prof.say(
      tested.clean
        ? `IT'S ALIVE! My robot played it and found no bugs. Behold: ${game.title}!`
        : `IT'S ALIVE! Mostly. A gremlin or two survived my robot. Tap ✏️ and tell me what's wrong!`,
      { mood: "laughing" },
    );
    openPlayer(game);
  } catch (err) {
    clearInterval(quips);
    if (signal.aborted || !getPendingBuild()) {
      setPendingBuild(null);
      if (job.artDone && !listGames().some((g) => g.id === job.id)) deleteArt(job.id);
      prof.set("Kaboom. That wasn't supposed to happen. Shall we try again?", "idle");
      showError($("error"), err);
    } else {
      keep({ error: err?.message || String(err) });
      offerResume();
    }
  } finally {
    clearInterval(quips);
    ticker.stop();
    abort = null;
    setBusy(false, $("buildBtn"), $("progress"));
    resetBuilder();
  }
}

const liveCallbacks = (ticker, onRetry) => ({
  onProgress: (n, text) => ticker.update(n, text),
  onThinking: (text) => ticker.thinking(text),
  onRetry: (n) => {
    ticker.retry(n);
    onRetry?.();
  },
});

/**
 * Let a robot play the game; send any errors back to Claude to fix, up to `rounds` times.
 * Resolves with { html, clean }.
 */
async function playtestAndFix({ apiKey, html, assets, ticker, signal, rounds, from, step }) {
  const span = (100 - from) / (rounds * 2 + 1);
  let at = from;
  for (let round = 0; ; round++) {
    ticker.stage(`${step} · ${round ? "Re-testing" : "Playtesting"}`, at, (at += span), 0, null, true);
    let errors;
    try {
      errors = await playtest(html, ticker.frame(), { signal, assets });
    } catch {
      return { html, clean: false }; // couldn't run the test (e.g. offline); keep the game as is
    }
    if (signal.aborted) throw new GenerationError("Cancelled.");
    if (!errors.length) return { html, clean: true };
    if (round >= rounds) return { html, clean: false };

    const bugs = `${errors.length} bug${errors.length > 1 ? "s" : ""}`;
    ticker.stage(`${step} · Fixing ${bugs} (${round + 1}/${rounds})`, at, (at += span), 3000, "🔧 Fixes being written");
    const change = `An automatic playtest (a robot tapping the screen and pressing keys for a few seconds) hit these errors:\n- ${errors.join("\n- ")}\n\nFind and fix the root causes. Keep the game the same otherwise.`;
    html = (await editGame({ apiKey, html, change, assets, signal, ...liveCallbacks(ticker) })).html;
  }
}

function resetBuilder() {
  $("quiz").hidden = true;
  $("form").hidden = false;
}

/** Progress line with a running clock, a progress bar, live thinking, live code and the playtest view. */
function progressTicker(el, live) {
  const started = Date.now();
  const bar = live.querySelector(".live-bar i");
  const thinkingEl = live.querySelector(".live-thinking");
  const codeEl = live.querySelector(".live-code");
  const codeLabel = live.querySelector(".live-code-label");
  const test = live.querySelector(".live-test");
  const artBox = live.querySelector(".live-art");
  let artTotal = 0;
  const frame = live.querySelector(".live-frame");
  let stage = { name: "", lo: 0, hi: 100, expected: 20_000, testing: false, start: started };
  let chars = 0;
  let note = "";
  live.hidden = false;

  const render = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const drawn = artBox.children.length;
    const doing = stage.testing
      ? "Tapping around…"
      : stage.art
        ? artTotal ? `Drawing ${Math.min(drawn + 1, artTotal)} of ${artTotal}…` : "Choosing what to draw…"
        : progressLabel(chars);
    el.textContent = `${note}${stage.name ? stage.name + " · " : ""}${doing} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    // Within a stage: thinking creeps up to 15%, writing fills the rest, slowing near the end.
    const elapsed = Date.now() - stage.start;
    const inner = stage.testing
      ? Math.min(1, elapsed / 9000)
      : stage.art
        ? artTotal ? Math.min(1, (artBox.children.length + 0.5) / artTotal) : 0.05
      : chars
        ? 0.15 + 0.83 * (1 - Math.exp(-chars / stage.expected))
        : 0.15 * (1 - Math.exp(-elapsed / 60_000));
    bar.style.width = `${(stage.lo + (stage.hi - stage.lo) * inner).toFixed(1)}%`;
  };
  const scrollDown = (pre) => (pre.scrollTop = pre.scrollHeight);
  const timer = setInterval(render, 1000);
  return {
    /** Start a step: progress runs from lo% to hi%. */
    stage(name, lo, hi, expected, label, mode = false) {
      const testing = mode === true;
      const art = Boolean(mode?.art);
      stage = { name, lo, hi, expected: expected || 1, testing, art, start: Date.now() };
      chars = 0;
      note = "";
      test.hidden = !testing;
      artBox.hidden = !art && (testing || !artBox.children.length);
      codeEl.hidden = codeLabel.hidden = testing || art;
      thinkingEl.hidden = thinkingEl.previousElementSibling.hidden = testing || art;
      if (label) codeLabel.textContent = label;
      if (!testing) {
        codeEl.textContent = "";
        thinkingEl.textContent = "Warming up the brain…";
      }
      render();
    },
    frame: () => frame,
    artCount(n) {
      artTotal = n;
      render();
    },
    art(key, asset) {
      const fig = document.createElement("figure");
      if (asset.kind === "background") fig.className = "bg";
      fig.append(Object.assign(document.createElement("img"), { src: asset.url, alt: key, title: key }));
      artBox.append(fig);
      render();
    },
    update(n, text) {
      chars = n;
      codeEl.textContent = text.slice(-1500);
      scrollDown(codeEl);
      render();
    },
    thinking(text) {
      if (!text) return;
      thinkingEl.textContent = text.slice(-600);
      scrollDown(thinkingEl);
    },
    retry(n) {
      note = `Connection lost, restarted (try ${n + 1}). `;
      chars = 0;
      stage.start = Date.now();
      render();
    },
    stop() {
      clearInterval(timer);
      frame.srcdoc = "";
      artBox.replaceChildren();
      live.hidden = true;
    },
  };
}

function progressLabel(chars) {
  return chars === 0 ? "Thinking…" : `Writing code… ${chars < 1000 ? chars : `${Math.round(chars / 1000)}k`} characters`;
}

// Keep the screen on while building: phones cut the connection when it sleeps.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    wakeLock = null;
  }
}
document.addEventListener("visibilitychange", () => {
  if (abort && document.visibilityState === "visible") keepAwake(true);
});

function setBusy(busy, button, progress, error) {
  keepAwake(busy);
  button.disabled = busy;
  progress.hidden = !busy;
  if (busy) {
    progress.querySelector("span").textContent = "Designing your game…";
    if (error) error.hidden = true;
  }
}

function showError(el, err) {
  el.textContent = err?.message || String(err);
  el.hidden = false;
}

// ---------- Gallery ----------

function renderGallery() {
  const games = listGames();
  const list = $("gallery");
  list.replaceChildren();
  $("emptyGallery").hidden = games.length > 0;

  for (const game of games) {
    const li = document.createElement("li");
    li.className = "game-item";

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = game.title;
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = game.history.at(-1);
    info.append(name, desc);

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "🗑";
    del.setAttribute("aria-label", `Delete ${game.title}`);
    del.addEventListener("click", () => {
      if (confirm(`Delete "${game.title}"?`)) {
        deleteGame(game.id);
        deleteArt(game.id);
        renderGallery();
      }
    });

    const play = document.createElement("button");
    play.className = "primary play";
    play.textContent = "Play";
    play.addEventListener("click", () => openPlayer(game));

    li.append(info, del, play);
    list.append(li);
  }
}

// ---------- Player ----------

/** Load the game into the player, with the game engine inlined. */
async function showInFrame(game) {
  $("frame").srcdoc = "";
  let html;
  try {
    html = await withPhaser(game.html, await loadArt(game.id));
  } catch (err) {
    html = `<body style="font:16px system-ui;color:#fff;background:#14121f;padding:24px">${err.message}</body>`;
  }
  if (currentGame?.id === game.id) $("frame").srcdoc = html;
}

function openPlayer(game) {
  currentGame = game;
  $("playerTitle").textContent = game.title;
  showInFrame(game);
  $("tweakPanel").hidden = true;
  $("tweakError").hidden = true;
  $("player").hidden = false;
  history.pushState({ player: true }, "");
}

function closePlayer() {
  if ($("player").hidden) return;
  abort?.abort();
  $("player").hidden = true;
  $("frame").srcdoc = "";
  currentGame = null;
}

async function tweak() {
  const prompt = $("tweakPrompt").value.trim();
  if (!prompt || !currentGame) return;
  const apiKey = requireKey();
  if (!apiKey) return;

  const game = currentGame;
  setBusy(true, $("tweakBtn"), $("tweakProgress"), $("tweakError"));
  abort = new AbortController();
  const signal = abort.signal;
  const ticker = progressTicker($("tweakProgressText"), $("tweakLive"));
  setPendingBuild({ kind: "tweak", gameId: game.id, prompt, at: Date.now() });
  try {
    ticker.stage("Changing", 0, 70, 4000, "🔧 Changes being written");
    const assets = await loadArt(game.id);
    const changed = await editGame({ apiKey, html: game.html, change: prompt, assets, signal, ...liveCallbacks(ticker) });
    let updated = { ...game, html: changed.html, title: changed.title || game.title, history: [...game.history, prompt] };
    saveGame(updated);
    setPendingBuild(null);

    const tested = await playtestAndFix({ apiKey, html: updated.html, assets, ticker, signal, rounds: 1, from: 70, step: "Checking" });
    updated = { ...updated, html: tested.html };
    saveGame(updated);
    renderGallery();
    $("tweakPrompt").value = "";
    if (currentGame?.id === game.id) openPlayerInPlace(updated);
  } catch (err) {
    showError($("tweakError"), err);
  } finally {
    setPendingBuild(null);
    ticker.stop();
    abort = null;
    setBusy(false, $("tweakBtn"), $("tweakProgress"));
  }
}

function openPlayerInPlace(game) {
  currentGame = game;
  $("playerTitle").textContent = game.title;
  showInFrame(game);
  $("tweakPanel").hidden = true;
}

// ---------- Keep a game (file / app) ----------

let watchTimer = null;

function openKeep() {
  if (!currentGame) return;
  $("keepError").hidden = true;
  $("tokenBox").hidden = true;
  renderPublishStatus(currentGame);
  $("keep").showModal();
}

function closeKeep() {
  clearInterval(watchTimer);
  if ($("keep").open) $("keep").close();
}

async function publishCurrent() {
  const game = currentGame;
  if (!game) return;
  const token = getGithubToken();
  if (!token) {
    $("tokenBox").hidden = false;
    $("githubToken").focus();
    return;
  }
  $("keepError").hidden = true;
  $("publishBtn").disabled = true;
  $("publishBtn").textContent = "Uploading…";
  try {
    const slug = await publishGame(game, token);
    const updated = { ...game, slug, publishedAt: Date.now(), publishedHash: hashText(game.html) };
    saveGame(updated);
    currentGame = updated;
    renderGallery();
    renderPublishStatus(updated);
  } catch (err) {
    showError($("keepError"), err);
  } finally {
    $("publishBtn").disabled = false;
    $("publishBtn").textContent = "📲 Make it an app";
  }
}

function renderPublishStatus(game) {
  clearInterval(watchTimer);
  const box = $("publishStatus");
  if (!game.slug || !game.publishedAt) {
    box.hidden = true;
    return;
  }
  const links = gameLinks(game.slug);
  // If the game changed after publishing, the online copy is the older version.
  const changedSince = game.publishedHash !== hashText(game.html);
  const state = { page: changedSince, apk: changedSince };
  const draw = () => {
    box.replaceChildren();
    const line = (done, doneHtml, waitText) => {
      const div = document.createElement("div");
      div.className = "step";
      if (done) {
        div.innerHTML = doneHtml;
      } else {
        const label = document.createElement("span");
        label.textContent = waitText;
        div.innerHTML = `<div class="spinner"></div>`;
        div.append(label);
      }
      box.append(div);
    };
    line(state.page, `✅ <a href="${links.page}" target="_blank" rel="noopener">Open the game</a>, then use "Add to Home screen"`, "Putting the game online…");
    line(state.apk, `✅ <a href="${links.apk}">Download the APK</a>`, "Building the APK (a few minutes)…");
    if (changedSince) {
      const note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "You changed the game since publishing. Tap “Make it an app” again to update it.";
      box.append(note);
    }
  };
  const check = async () => {
    const token = getGithubToken();
    if (!token) return;
    Object.assign(state, await checkPublished(game, token));
    draw();
    if (state.page && state.apk) clearInterval(watchTimer);
  };
  box.hidden = false;
  draw();
  if (changedSince) return;
  check();
  watchTimer = setInterval(check, 15_000);
}

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return h;
}

$("keepBtn").addEventListener("click", openKeep);
$("keepClose").addEventListener("click", closeKeep);
$("keep").addEventListener("close", () => clearInterval(watchTimer));
$("saveFileBtn").addEventListener("click", () => currentGame && saveAsFile(currentGame));
$("publishBtn").addEventListener("click", publishCurrent);
$("tokenSaveBtn").addEventListener("click", () => {
  const token = $("githubToken").value.trim();
  if (!token) return $("githubToken").focus();
  setGithubToken(token);
  $("tokenBox").hidden = true;
  publishCurrent();
});

// ---------- Settings ----------

function openSettings({ admin = false } = {}) {
  $("apiKey").value = getApiKey();
  $("workspaceId").value = getWorkspaceId();
  $("githubTokenSettings").value = getGithubToken();
  $("geminiKey").value = getGeminiKey();
  $("adminPassword").value = $("adminNewPassword").value = "";
  $("adminStatus").hidden = true;
  if (admin) $("adminBox").open = true;
  $("settings").showModal();
}

function applyKeys(keys) {
  setApiKey(keys.anthropicKey || "");
  setWorkspaceId(keys.workspaceId || "");
  if (keys.githubToken) setGithubToken(keys.githubToken);
  setGeminiKey(keys.geminiKey || "");
}

// Encrypt the keys with the app password and commit them, so every device gets them.
async function saveSharedKeys() {
  const status = $("adminStatus");
  const say = (text, ok = false) => {
    status.textContent = text;
    status.className = `small ${ok ? "ok" : "error"}`;
    status.hidden = false;
  };
  const password = $("adminPassword").value.trim();
  const newPassword = $("adminNewPassword").value.trim();
  const token = $("githubTokenSettings").value.trim();
  if (!password) return say("Enter the app password to save.");
  if (!token) return say("A GitHub token is needed to save keys for all devices.");

  $("adminSave").disabled = true;
  try {
    say("Checking the password…", true);
    const current = await fetchVault();
    await openVault(current, password).catch(() => {
      throw new Error("Wrong app password.");
    });
    const keys = {
      anthropicKey: $("apiKey").value.trim(),
      workspaceId: $("workspaceId").value.trim(),
      githubToken: token,
      geminiKey: $("geminiKey").value.trim(),
      updatedAt: new Date().toISOString(),
    };
    const { file, rememberedKey } = await sealVault(newPassword || password, keys, newPassword ? null : current.salt);
    say("Saving to GitHub…", true);
    await commitFile(token, "public/keys.enc.json", JSON.stringify(file, null, 2) + "\n", "Update shared keys");
    adoptVault(file, rememberedKey);
    applyKeys(keys);
    say(
      newPassword
        ? "Saved, with the new password. Other devices get the keys in about 2 minutes and will ask for the new password."
        : "Saved. Other devices get the new keys in about 2 minutes.",
      true,
    );
  } catch (err) {
    say(err.message || String(err));
  } finally {
    $("adminSave").disabled = false;
  }
}

$("adminSave").addEventListener("click", saveSharedKeys);
$("cancelSettings").addEventListener("click", () => $("settings").close("cancel"));

// ---------- Version & updates ----------

/* global __APP_VERSION__, __BUILT_AT__ */
const isApp = Boolean(window.Capacitor?.isNativePlatform?.());

function showVersion() {
  const built = new Date(__BUILT_AT__).toLocaleString();
  $("version").textContent = `Version ${__APP_VERSION__}`;
  $("settingsVersion").textContent = `Version ${__APP_VERSION__} · built ${built}${isApp ? " · Android app" : ""}`;
  $("apkLink").hidden = isApp || !/android/i.test(navigator.userAgent);
}

// Compare against the deployed version.json and offer a reload when it changed.
async function checkForUpdate() {
  if (__APP_VERSION__ === "dev") return;
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    const { version } = await res.json();
    $("updateBanner").hidden = !version || version === __APP_VERSION__;
  } catch {}
}

$("updateBanner").addEventListener("click", async () => {
  $("updateBanner").textContent = "Updating…";
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
  // The phone's own cache can keep serving the old files for a while after a deploy,
  // so fetch fresh copies before reloading.
  await Promise.all(["./", "index.html", "app.js", "styles.css"].map((f) => fetch(f, { cache: "reload" }).catch(() => {})));
  location.reload();
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate());

// ---------- Interrupted builds ----------

/** What a saved build already has, in words. */
function savedParts(job) {
  const parts = [job.plan && "the plan", job.artDone && "the art", job.partial && `${Math.round(job.partial.length / 1000)}k characters of code`];
  const have = parts.filter(Boolean);
  return have.length ? `Saved so far: ${have.join(", ")}.` : "All your answers are saved.";
}

/** A build or change that stopped (page reload, lost connection, out of credits): offer to carry on. */
function offerResume() {
  const job = getPendingBuild();
  if (!job) return;
  const game = job.kind === "tweak" ? listGames().find((g) => g.id === job.gameId) : null;
  if (job.kind === "tweak" && !game) return setPendingBuild(null);
  const failed = Boolean(job.error);
  const why = failed ? `stopped: ${job.error.replace(/\.$/, "")}` : "got interrupted when the page reloaded";
  $("resumeText").textContent =
    job.kind === "tweak"
      ? `Your change to "${game.title}" ${why}.`
      : `Your game ("${job.idea || "surprise game"}") ${why}. ${savedParts(job)} Tap Continue to pick up from there.`;
  $("resumeBtn").textContent = job.kind === "tweak" ? "Try again 🔁" : "Continue building ▶️";
  $("resumeBox").hidden = false;
  if (!failed) prof.say("Blast! Someone pulled the plug mid-experiment. Shall I carry on?", { mood: "thinking" });
  else prof.say("Kaboom! But I saved my notes. We can carry on whenever you're ready.", { mood: "thinking" });
  $("resumeBtn").onclick = async () => {
    $("resumeBox").hidden = true;
    $("error").hidden = true;
    if (job.kind === "tweak") {
      setPendingBuild(null);
      openPlayer(game);
      $("tweakPanel").hidden = false;
      $("tweakPrompt").value = job.prompt;
      tweak();
    } else {
      build(job.idea, job.answers, job);
    }
  };
  $("resumeDismiss").onclick = () => {
    $("resumeBox").hidden = true;
    setPendingBuild(null);
    if (job.id && !listGames().some((g) => g.id === job.id)) deleteArt(job.id);
  };
}

// ---------- Wiring ----------

$("buildBtn").addEventListener("click", start);
$("cancelBtn").addEventListener("click", () => abort?.abort());
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    start();
  }
});
$("settingsBtn").addEventListener("click", () => openSettings());
$("closePlayer").addEventListener("click", () => {
  closePlayer();
  if (history.state?.player) history.back();
});
$("restartBtn").addEventListener("click", () => currentGame && showInFrame(currentGame));
$("tweakToggle").addEventListener("click", () => {
  $("tweakPanel").hidden = !$("tweakPanel").hidden;
  if (!$("tweakPanel").hidden) $("tweakPrompt").focus();
});
$("tweakBtn").addEventListener("click", tweak);
window.addEventListener("popstate", closePlayer);

renderIdeas();
renderGallery();
showVersion();
checkForUpdate();
unlockApp().then((keys) => {
  applyKeys(keys);
  document.body.classList.remove("locked");
  if (getApiKey()) prof.say(pick(GREETINGS));
  else prof.say("Welcome! Before I can build anything, the admin must add an API key in ⚙️ Settings.", { mood: "thinking" });
  offerResume();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
