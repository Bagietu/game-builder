// Keeping a game: save it as a file, or publish it to the repo so GitHub
// builds it into its own installable app (home-screen icon + APK).

import { withPhaser } from "./playtest.js";

const REPO = "Bagietu/game-builder";
const SITE = "https://bagietu.github.io/game-builder";

export function slugFor(game) {
  const base =
    game.title
      .toLowerCase()
      .replace(/ł/g, "l")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "game";
  return `${base}-${game.id.slice(0, 6).replace(/[^a-z0-9]/g, "x")}`;
}

export const gameLinks = (slug) => ({
  page: `${SITE}/games/${slug}/`,
  apk: `https://github.com/${REPO}/releases/download/game-${slug}/${slug}.apk`,
});

/** Share the game as an .html file (Android share sheet), or download it. */
export async function saveAsFile(game) {
  const name = `${slugFor(game)}.html`;
  const file = new File([await withPhaser(game.html)], name, { type: "text/html" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: game.title });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function github(token, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  return res;
}

/** Commit the game to games/<slug>/game.html. Returns the slug. */
export async function publishGame(game, token) {
  const slug = game.slug || slugFor(game);
  const path = `games/${slug}/game.html`;

  // Updating an existing file needs its current sha.
  let sha;
  const existing = await github(token, `contents/${path}?ref=main`);
  if (existing.ok) sha = (await existing.json()).sha;
  else if (existing.status === 401) throw new Error("GitHub rejected the token. Check it in Settings.");

  const res = await github(token, `contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add game: ${game.title}`,
      content: toBase64(await withPhaser(game.html)),
      branch: "main",
      ...(sha && { sha }),
    }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("GitHub rejected the token. Check it in Settings.");
    if (res.status === 403 || res.status === 404) {
      throw new Error("This token can't write to the game-builder repo. It needs Contents: Read and write.");
    }
    throw new Error(`GitHub error ${res.status}. Try again in a moment.`);
  }
  return slug;
}

/** Which parts of this exact version are live yet: { page, apk }. `since` is when it was published. */
export async function checkPublished(slug, token, html, since) {
  html = await withPhaser(html);
  const [page, apk] = await Promise.all([
    fetch(`${SITE}/games/${slug}/game.html`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => text === html, () => false),
    github(token, `releases/tags/game-${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (rel) => Boolean(rel?.assets?.some((a) => a.name === `${slug}.apk` && Date.parse(a.updated_at) >= since - 60_000)),
        () => false,
      ),
  ]);
  return { page, apk };
}
