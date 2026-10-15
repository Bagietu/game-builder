import { professorTurn, generateGame } from "./generate.js";
import { ensureUnlocked } from "./lock.js";
import { saveAsFile, publishGame, checkPublished, gameLinks } from "./install.js";
import { Professor, GREETINGS, THINKING_LINES, BUILD_LINES, pick } from "./professor.js";
import { getApiKey, setApiKey, getWorkspaceId, setWorkspaceId, getGithubToken, setGithubToken, listGames, saveGame, deleteGame } from "./storage.js";

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
  if (!key) openSettings();
  return key;
}

// Step 1: the professor interviews the player, one adaptive question at a time.
let interview = null;

async function start() {
  if (!(await ensureUnlocked())) return;
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
  prof.say(turn.question).then(() => {
    if (turn.reaction) {
      const r = document.createElement("span");
      r.className = "reaction";
      r.textContent = turn.reaction;
      $("bubbleText").prepend(r);
    }
  });

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
  prof.say(`${turn.question} ${FINAL_QUESTION}`).then(() => {
    if (turn.reaction) {
      const r = document.createElement("span");
      r.className = "reaction";
      r.textContent = turn.reaction;
      $("bubbleText").prepend(r);
    }
  });
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
async function build(idea, answers) {
  interview = null;
  $("quiz").hidden = true;
  $("form").hidden = true;
  const apiKey = requireKey();
  if (!apiKey) return resetBuilder();
  const prompt = composePrompt(idea, answers);
  const summary = [idea, ...answers.map((a) => a.answer)].filter(Boolean).join(" · ") || "Surprise game";

  setBusy(true, $("buildBtn"), $("progress"), $("error"));
  $("progressText").textContent = "Building your game…";
  const quips = setInterval(() => prof.set(pick(BUILD_LINES), "working"), 3500);
  setTimeout(() => prof.set(pick(BUILD_LINES), "working"), 1500);
  abort = new AbortController();
  try {
    const { html, title } = await generateGame({
      apiKey,
      prompt,
      signal: abort.signal,
      onProgress: (n) => ($("progressText").textContent = progressLabel(n)),
      onRetry: () => prof.set("The connection fizzled! Rewiring the doohickey and starting over…", "working"),
    });
    const game = { id: crypto.randomUUID(), title: title || summary, prompt, html, history: [summary] };
    saveGame(game);
    $("prompt").value = "";
    renderGallery();
    clearInterval(quips);
    prof.say(`IT'S ALIVE! Behold: ${game.title}! Want another one?`, { mood: "laughing" });
    openPlayer(game);
  } catch (err) {
    clearInterval(quips);
    prof.set("Kaboom. That wasn't supposed to happen. Shall we try again?", "idle");
    showError($("error"), err);
  } finally {
    clearInterval(quips);
    abort = null;
    setBusy(false, $("buildBtn"), $("progress"));
    resetBuilder();
  }
}

function resetBuilder() {
  $("quiz").hidden = true;
  $("form").hidden = false;
}

function progressLabel(chars) {
  return chars === 0 ? "Designing your game…" : `Writing code… ${Math.round(chars / 1000)}k characters`;
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

function openPlayer(game) {
  currentGame = game;
  $("playerTitle").textContent = game.title;
  $("frame").srcdoc = game.html;
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
  if (!(await ensureUnlocked())) return;
  const apiKey = requireKey();
  if (!apiKey) return;

  const game = currentGame;
  setBusy(true, $("tweakBtn"), $("tweakProgress"), $("tweakError"));
  abort = new AbortController();
  try {
    const { html, title } = await generateGame({
      apiKey,
      prompt,
      currentHtml: game.html,
      signal: abort.signal,
      onProgress: (n) => ($("tweakProgressText").textContent = progressLabel(n)),
      onRetry: () => ($("tweakProgressText").textContent = "Connection dropped, starting over…"),
    });
    const updated = { ...game, html, title: title || game.title, history: [...game.history, prompt] };
    saveGame(updated);
    renderGallery();
    $("tweakPrompt").value = "";
    if (currentGame?.id === game.id) openPlayerInPlace(updated);
  } catch (err) {
    showError($("tweakError"), err);
  } finally {
    abort = null;
    setBusy(false, $("tweakBtn"), $("tweakProgress"));
  }
}

function openPlayerInPlace(game) {
  currentGame = game;
  $("playerTitle").textContent = game.title;
  $("frame").srcdoc = game.html;
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
  if (!(await ensureUnlocked())) return;
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
    Object.assign(state, await checkPublished(game.slug, token, game.html, game.publishedAt));
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

function openSettings() {
  $("apiKey").value = getApiKey();
  $("workspaceId").value = getWorkspaceId();
  $("githubTokenSettings").value = getGithubToken();
  $("settings").showModal();
}

$("cancelSettings").addEventListener("click", () => $("settings").close("cancel"));
$("settings").addEventListener("close", () => {
  if ($("settings").returnValue === "save") {
    setApiKey($("apiKey").value.trim());
    setWorkspaceId($("workspaceId").value.trim());
    setGithubToken($("githubTokenSettings").value.trim());
  }
});

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
  const reg = await navigator.serviceWorker?.getRegistration();
  await reg?.update().catch(() => {});
  location.reload();
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate());

// ---------- Wiring ----------

$("buildBtn").addEventListener("click", start);
$("cancelBtn").addEventListener("click", () => abort?.abort());
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    start();
  }
});
$("settingsBtn").addEventListener("click", openSettings);
$("closePlayer").addEventListener("click", () => {
  closePlayer();
  if (history.state?.player) history.back();
});
$("restartBtn").addEventListener("click", () => currentGame && ($("frame").srcdoc = currentGame.html));
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
prof.say(pick(GREETINGS));
if (!getApiKey()) openSettings();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
