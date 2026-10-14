import { generateGame } from "./generate.js";
import { getApiKey, setApiKey, listGames, saveGame, deleteGame } from "./storage.js";

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

async function build() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return $("prompt").focus();
  const apiKey = requireKey();
  if (!apiKey) return;

  setBusy(true, $("buildBtn"), $("progress"), $("error"));
  abort = new AbortController();
  try {
    const { html, title } = await generateGame({
      apiKey,
      prompt,
      signal: abort.signal,
      onProgress: (n) => ($("progressText").textContent = progressLabel(n)),
    });
    const game = { id: crypto.randomUUID(), title: title || prompt, prompt, html, history: [prompt] };
    saveGame(game);
    $("prompt").value = "";
    renderGallery();
    openPlayer(game);
  } catch (err) {
    showError($("error"), err);
  } finally {
    abort = null;
    setBusy(false, $("buildBtn"), $("progress"));
  }
}

function progressLabel(chars) {
  return chars === 0 ? "Designing your game…" : `Writing code… ${Math.round(chars / 1000)}k characters`;
}

function setBusy(busy, button, progress, error) {
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

// ---------- Settings ----------

function openSettings() {
  $("apiKey").value = getApiKey();
  $("settings").showModal();
}

$("settings").addEventListener("close", () => {
  if ($("settings").returnValue === "save") setApiKey($("apiKey").value.trim());
});

// ---------- Wiring ----------

$("buildBtn").addEventListener("click", build);
$("cancelBtn").addEventListener("click", () => abort?.abort());
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
if (!getApiKey()) openSettings();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
