const GAMES_KEY = "gb.games";
const API_KEY_KEY = "gb.apiKey";
const WORKSPACE_KEY = "gb.workspaceId";
const GITHUB_TOKEN_KEY = "gb.githubToken";
const PENDING_KEY = "gb.pendingBuild";
const GEMINI_KEY = "gb.geminiKey";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const getApiKey = () => read(API_KEY_KEY, "");
export const setApiKey = (key) => write(API_KEY_KEY, key);
export const getWorkspaceId = () => read(WORKSPACE_KEY, "");
export const setWorkspaceId = (id) => write(WORKSPACE_KEY, id);
export const getGithubToken = () => read(GITHUB_TOKEN_KEY, "");
export const setGithubToken = (token) => write(GITHUB_TOKEN_KEY, token);
export const getGeminiKey = () => read(GEMINI_KEY, "");
export const setGeminiKey = (key) => write(GEMINI_KEY, key);

/** A build or change that was running when the page went away: { kind, ... }. */
export const getPendingBuild = () => read(PENDING_KEY, null);
export const setPendingBuild = (job) => (job ? write(PENDING_KEY, job) : localStorage.removeItem(PENDING_KEY));

/** Games, newest first: { id, title, prompt, html, history: string[], updatedAt } */
export const listGames = () => read(GAMES_KEY, []);

export function saveGame(game) {
  const games = listGames().filter((g) => g.id !== game.id);
  games.unshift({ ...game, updatedAt: Date.now() });
  if (!write(GAMES_KEY, games)) {
    throw new Error("Couldn't save: this device's storage is full. Delete a game and try again.");
  }
}

export function deleteGame(id) {
  write(GAMES_KEY, listGames().filter((g) => g.id !== id));
}
