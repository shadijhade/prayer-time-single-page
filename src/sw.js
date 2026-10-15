// sw.js: the app shell is served cache-first, so the app opens instantly and works offline
// (prayer times are calculated on the device). City files are stale-while-revalidate.
// Bump APP_SHELL_CACHE_NAME whenever a file in APP_SHELL_ASSETS changes, or returning users keep the old one.
const APP_SHELL_CACHE_NAME = "prayer-times-shell-v1.3.0";
const CITIES_CACHE_NAME = "prayer-times-cities-v1";

const APP_SHELL_ASSETS = [
  "./", // The page itself (start_url)
  "app.js",
  "prayer-rules.js",
  "adhan.umd.js",
  "style.css",
  "manifest.json",
  "favicon.ico",
  "favicon-96x96.png",
  "fonts/tajawal-400-arabic.woff2",
  "fonts/tajawal-400-latin.woff2",
  "fonts/tajawal-500-arabic.woff2",
  "fonts/tajawal-500-latin.woff2",
  "fonts/tajawal-700-arabic.woff2",
  "fonts/tajawal-700-latin.woff2",
];
const APP_SHELL_PATHS = new Set(
  APP_SHELL_ASSETS.map((asset) => new URL(asset, self.location).pathname)
);
const CITIES_PATH = new URL("cities/", self.location).pathname;

self.addEventListener("install", (event) => {
  // "no-cache" revalidates, so files the page has just downloaded aren't downloaded again
  const requests = APP_SHELL_ASSETS.map(
    (asset) => new Request(asset, { cache: "no-cache" })
  );
  event.waitUntil(
    caches.open(APP_SHELL_CACHE_NAME).then((cache) => cache.addAll(requests))
  );
  // No skipWaiting here: the page shows an "update available" bar and the user decides
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => ![APP_SHELL_CACHE_NAME, CITIES_CACHE_NAME].includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (APP_SHELL_PATHS.has(url.pathname)) {
    // ignoreSearch: "/?utm_source=..." is still the cached "/"
    event.respondWith(
      caches
        .match(request, { ignoreSearch: true })
        .then((cached) => cached || fetch(request))
    );
  } else if (url.pathname.startsWith(CITIES_PATH)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/** Answers from the cache when it can and refreshes the cached copy in the background. */
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CITIES_CACHE_NAME);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((response) => {
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {})); // Offline, the refresh just fails
  return cached || network;
}

self.addEventListener("message", (event) => {
  if (event.data?.action === "skipWaiting") self.skipWaiting();
});
