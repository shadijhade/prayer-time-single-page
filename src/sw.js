// sw.js
// --- Configuration ---
const APP_SHELL_CACHE_NAME = "prayer-times-shell-v1.0.1"; // <<<--- INCREMENT THIS IF YOU MAKE SIGNIFICANT SW CHANGES
const RUNTIME_CACHE_NAME = "prayer-times-runtime-v1";
const OFFLINE_URL = "/offline.html";

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/web-app-manifest-512x512.png",
  "/web-app-manifest-192x192.png",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-96x96.png", // Icon used for notifications
  "/apple-touch-icon.png",
  "/adhan.umd.js",
  "/style.css",
  "/app.js",
  OFFLINE_URL,
  // Add essential CSS if separate file, fonts if self-hosted etc.
];

const RUNTIME_PATTERNS = [
  // Make font patterns more specific if needed
  /^https:\/\/fonts\.googleapis\.com\//,
  /^https:\/\/fonts\.gstatic\.com\//,
  /^https:\/\/api\.bigdatacloud\.net\/data\/reverse-geocode-client/,
];

const ALL_CACHES = [APP_SHELL_CACHE_NAME, RUNTIME_CACHE_NAME];

// --- Service Worker Lifecycle ---

self.addEventListener("install", (event) => {
  console.log(`SW (${APP_SHELL_CACHE_NAME}): Installing...`);
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE_NAME)
      .then((cache) => {
        console.log(`SW (${APP_SHELL_CACHE_NAME}): Caching App Shell`);
        const cachePromises = APP_SHELL_ASSETS.map((assetUrl) => {
          const request = new Request(assetUrl, { cache: "reload" }); // Force network request during install
          return fetch(request)
            .then((response) => {
              if (!response.ok) {
                throw new Error(
                  `Request for ${assetUrl} failed with status ${response.status}`
                );
              }
              return cache.put(request, response);
            })
            .catch((err) => {
              console.warn(
                `SW: Failed to fetch/cache ${assetUrl} during install:`,
                err
              );
              // Decide if install should fail
              if (["/", "/index.html", "/adhan.umd.js"].includes(assetUrl)) {
                // Maybe throw error only for *critical* assets
                // throw err;
              }
            });
        });
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log(
          `SW (${APP_SHELL_CACHE_NAME}): App Shell caching complete. Installing finished.`
        );
        // Don't skipWaiting here automatically, let the user decide via the notification
      })
      .catch((error) => {
        console.error(
          `SW (${APP_SHELL_CACHE_NAME}): App Shell caching failed during install:`,
          error
        );
        // Skip waiting might not be safe if install failed significantly
      })
  );
});

self.addEventListener("activate", (event) => {
  console.log(`SW (${APP_SHELL_CACHE_NAME}): Activating...`);
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!ALL_CACHES.includes(cacheName)) {
              console.log(
                `SW (${APP_SHELL_CACHE_NAME}): Deleting old cache:`,
                cacheName
              );
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log(
          `SW (${APP_SHELL_CACHE_NAME}): Old caches cleared. Claiming clients.`
        );
        return self.clients.claim(); // Take control immediately
      })
      .catch((error) => {
        console.error(
          `SW (${APP_SHELL_CACHE_NAME}): Activation failed:`,
          error
        );
      })
  );
});

// --- Fetch Event Handling ---
// Your existing fetch strategies: cacheFirstWithOfflineFallback, staleWhileRevalidate, networkFirstWithOfflineFallback
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests
  if (request.method !== "GET") {
    return;
  }
  // Ignore requests to chrome extensions or other non-http protocols
  if (!url.protocol.startsWith("http")) {
    return;
  }
  // Ignore browser-sync during development
  if (url.pathname === "/browser-sync/socket.io/") {
    return;
  }

  // Find if the request URL's *pathname* matches any App Shell asset's pathname
  const isAppShellAsset = APP_SHELL_ASSETS.some((asset) => {
    try {
      // Compare only pathnames, ignoring origin/query/hash
      return new URL(asset, self.location.origin).pathname === url.pathname;
    } catch (e) {
      // Handle potential invalid URLs in APP_SHELL_ASSETS during comparison
      console.warn(`SW: Invalid URL in APP_SHELL_ASSETS: ${asset}`);
      return false;
    }
  });

  if (isAppShellAsset) {
    event.respondWith(
      cacheFirstWithOfflineFallback(request, APP_SHELL_CACHE_NAME, OFFLINE_URL)
    );
    return;
  }

  const isRuntimeAsset = RUNTIME_PATTERNS.some((pattern) =>
    pattern.test(request.url)
  );
  if (isRuntimeAsset) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE_NAME));
    return;
  }

  // Specific handling for navigation requests (HTML pages)
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirstWithOfflineFallback(
        request,
        APP_SHELL_CACHE_NAME, // Use app shell cache for navigation fallback
        OFFLINE_URL
      )
    );
    return;
  }

  // Default: Network only for anything else (e.g., API calls not matched by runtime patterns)
  // console.log(`SW: Fetching directly (passthrough): ${request.url}`);
  // event.respondWith(fetch(request)); // Explicitly fetch if no other strategy matches
});

// --- Caching Strategy Helpers ---
// Your existing strategy functions: cacheFirstWithOfflineFallback, staleWhileRevalidate, networkFirstWithOfflineFallback
async function cacheFirstWithOfflineFallback(request, cacheName, offlineUrl) {
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // console.log(`SW: [CacheFirst] Serving from cache: ${request.url}`);
      return cachedResponse;
    }
    // console.log(`SW: [CacheFirst] Not in cache, trying network: ${request.url}`);
    // Don't try network here for App Shell assets, rely on install caching
    // If it's not in cache, it likely failed install or was removed. Serve offline.
    // throw new Error("Asset not found in cache"); // Trigger catch block
    const offlineResponse = await cache.match(offlineUrl);
    if (offlineResponse) {
      console.warn(
        `SW: [CacheFirst] Asset ${request.url} not in cache. Serving offline fallback.`
      );
      return offlineResponse;
    }
    throw new Error("Offline page not found in cache either.");
  } catch (error) {
    console.warn(
      `SW: [CacheFirst] Error serving ${request.url}. Serving offline fallback.`,
      error
    );
    try {
      const cache = await caches.open(cacheName); // Ensure cache is open
      const offlineResponse = await cache.match(offlineUrl);
      if (offlineResponse) {
        return offlineResponse;
      }
    } catch (cacheError) {
      console.error("SW: Error accessing cache for offline page:", cacheError);
    }

    // Absolute fallback
    return new Response("<h1>Offline</h1><p>Content unavailable.</p>", {
      headers: { "Content-Type": "text/html" },
      status: 503,
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponsePromise = cache.match(request);
  const networkResponsePromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        // console.log(`SW: [SWR] Caching network response for: ${request.url}`);
        cache.put(request, networkResponse.clone()).catch((err) => {
          console.warn(`SW: [SWR] Failed to cache ${request.url}`, err);
        });
      } else if (networkResponse && !networkResponse.ok) {
        // Don't cache non-ok responses
        console.warn(
          `SW: [SWR] Network response not OK for ${request.url} (${networkResponse.status}). Not caching.`
        );
      }
      return networkResponse;
    })
    .catch((error) => {
      console.warn(`SW: [SWR] Network fetch failed for ${request.url}:`, error);
      return null; // Indicate network failure
    });

  const cachedResponse = await cachedResponsePromise;
  if (cachedResponse) {
    // console.log(`SW: [SWR] Serving from cache: ${request.url}`);
    return cachedResponse;
  }

  // console.log(`SW: [SWR] No cache, waiting for network: ${request.url}`);
  const networkResponse = await networkResponsePromise;
  if (networkResponse) {
    // console.log(`SW: [SWR] Serving from network: ${request.url}`);
    return networkResponse;
  }

  // Fallback if both cache and network fail
  console.error(`SW: [SWR] Both cache & network failed for: ${request.url}`);
  // Consider specific fallbacks based on request type
  return new Response("Resource unavailable.", { status: 503 });
}

async function networkFirstWithOfflineFallback(request, cacheName, offlineUrl) {
  try {
    // console.log(`SW: [NetworkFirst] Trying network: ${request.url}`);
    const networkResponse = await fetch(request);
    // Cache the main page ('/' or '/index.html') on success for offline
    // Check if it's an HTML page before caching from network
    const isHtmlPage = request.headers.get("accept")?.includes("text/html");
    if (networkResponse.ok && isHtmlPage) {
      const cache = await caches.open(cacheName);
      // console.log(`SW: [NetworkFirst] Caching navigation page from network: ${request.url}`);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn(
      `SW: [NetworkFirst] Network failed for ${request.url}. Trying cache.`,
      error
    );
    try {
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request); // Try matching the exact request first
      if (cachedResponse) {
        // console.log(`SW: [NetworkFirst] Serving from cache: ${request.url}`);
        return cachedResponse;
      }
      // If exact match fails, try matching the root page as a fallback for navigation
      const rootPageRequest = new Request("/", {
        headers: request.headers,
        mode: "navigate",
      });
      const rootCachedResponse = await cache.match(rootPageRequest);
      if (rootCachedResponse) {
        console.log(
          `SW: [NetworkFirst] Serving root page from cache as fallback for navigation to ${request.url}`
        );
        return rootCachedResponse;
      }

      console.warn(
        `SW: [NetworkFirst] Not in cache for ${request.url}. Serving offline fallback.`
      );
      const offlineResponse = await cache.match(offlineUrl);
      if (offlineResponse) {
        return offlineResponse;
      }
      throw new Error("Offline page also not found in cache.");
    } catch (cacheError) {
      console.error(
        `SW: [NetworkFirst] Error accessing cache or offline page during fallback: ${cacheError}`
      );
      // Absolute fallback
      return new Response("<h1>Offline</h1><p>Content unavailable.</p>", {
        headers: { "Content-Type": "text/html" },
        status: 503,
      });
    }
  }
}

// ---> Message Handling <---
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "skipWaiting") {
    console.log(
      `SW (${APP_SHELL_CACHE_NAME}): Received skipWaiting message. Attempting to skip waiting.`
    );
    self.skipWaiting(); // This prompts the new SW to activate
  }
});

