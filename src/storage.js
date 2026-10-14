const GAMES_KEY = "gb.games";
const API_KEY_KEY = "gb.apiKey";

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
