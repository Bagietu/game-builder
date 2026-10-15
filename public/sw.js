// Keeps the app shell available offline. API calls go straight to the network.
const CACHE = "game-builder-v5";
const SHELL = ["./", "index.html", "offline.html", "vendor/phaser.min.js", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network first so new deploys show up, cache as the offline fallback. Page loads give
// up on a slow network after a few seconds (common right after a phone wakes up).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const fromCache = () => caches.match(event.request).then((hit) => hit || caches.match("./"));
  // no-cache: always ask the server (cheap when unchanged), never trust the browser cache.
  const network = fetch(event.request, { cache: "no-cache" }).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  });
  if (event.request.mode !== "navigate") {
    event.respondWith(network.catch(fromCache));
    return;
  }
  event.respondWith(
    new Promise((resolve) => {
      let done = false;
      const finish = (res) => !done && res && ((done = true), resolve(res));
      const timer = setTimeout(() => fromCache().then(finish), 5000);
      network
        .then((res) => (res.ok ? finish(res) : fromCache().then((hit) => finish(hit || res))))
        .catch(() => fromCache().then((hit) => finish(hit || Response.error())))
        .finally(() => clearTimeout(timer));
    }),
  );
});
