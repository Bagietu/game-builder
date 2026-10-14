# Game Builder

A game where you build games from prompts.

Describe the game you want in plain words ("a platformer where a cat collects fish", "a space shooter with waves of asteroids") and Game Builder turns that prompt into a playable game you can try, tweak with more prompts, and keep.

## How it works

- It's a mobile-first web app you can install on your phone's home screen (PWA).
- You type an idea (or leave it empty), and Professor Pixelwhisk, an animated mad scientist, interviews you one question at a time, teasing each answer and picking the next question based on what you said (Claude Opus 5.5 at low effort). Then the app asks Claude to write a small, self-contained HTML5 game with touch controls from your answers.
- The game runs in a sandboxed frame inside the app. Tap ✏️ to change it with another prompt.
- Games are saved in your browser on that device.
- You add your own Anthropic API key in Settings (⚙️). It stays on your device and is only sent to Anthropic's API. Each build is billed to that key.

## Open it on your phone

The app is published with GitHub Pages on every push to `main` (see `.github/workflows/pages.yml`). Open the Pages URL on your phone, then use "Add to Home Screen" (Safari share menu, or Chrome's ⋮ menu) to get an app icon.

Pages must be turned on once: repo **Settings → Pages → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan; on the free plan, make the repo public first.

## Develop

```sh
npm install
npm run dev    # http://localhost:8000, rebuilds on change
npm run build  # outputs dist/
```

The Android app (`.github/workflows/android.yml`) is a Capacitor shell that loads the Pages site, so it always runs the latest version. Each push to `main` publishes `game-builder.apk` on the [latest release](https://github.com/Bagietu/game-builder/releases/latest). It is signed with the debug key in `android-support/` so new APKs install over old ones.

Code lives in `src/` (bundled with esbuild into `dist/app.js`) and static files in `public/`.
