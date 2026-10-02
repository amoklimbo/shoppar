// Service worker: rede primeiro (as atualizações chegam logo), cache só para uso offline.
const CACHE = "shoppar-v3-4";
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2",
  "/manifest.webmanifest",
  "/js/main.js",
  "/js/state.js",
  "/js/i18n.js",
  "/js/translations.js",
  "/js/dom.js",
  "/js/api.js",
  "/js/auth.js",
  "/js/catalog.js",
  "/js/names.js",
  "/js/lists.js",
  "/js/history.js",
  "/js/recipes.js",
  "/js/search.js",
  "/js/views.js",
  "/js/prefs.js",
  "/icons/shoppar-64.png",
  "/icons/shoppar-180.png",
  "/icons/shoppar-192.png",
  "/icons/shoppar-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || (request.mode === "navigate" ? caches.match("/index.html") : Response.error())),
  );
});
