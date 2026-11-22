"use strict";
const CACHE_PREFIX = `listx:${self.registration.scope}:`;
const CACHE_NAME = CACHE_PREFIX + "v51-isolated";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./imgs/icon-192.png",
  "./imgs/icon-512.png",
  "./fonts/tajawal-400-arabic.woff2",
  "./fonts/tajawal-500-arabic.woff2",
  "./fonts/tajawal-700-arabic.woff2",
  "./fonts/inter-var-latin.woff2",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map(async (asset) => {
          const response = await fetch(new Request(asset, { cache: "reload" }));
          if (!response.ok) throw new Error("App asset unavailable");
          await cache.put(asset, response);
        }),
      ),
    ),
  );
  // Let an existing session finish before activating a different app version.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  // Cache only the known app shell, never arbitrary requests or other apps.
  const scope = new URL("./", self.location.href);
  const known = ASSETS.some((asset) => new URL(asset, scope).href === url.href);
  if (!known) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }),
  );
});
