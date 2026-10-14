// EarlyEye for guards: app shell service worker (scope /guard).
// Pages: network first, the cached shell when offline. Data (events, plan) always from the network.
const CACHE = "earlyeye-guard-v2";
// Who this phone is and where its alerts come from (written by the app on Start my shift).
const META = "earlyeye-guard-meta";
const SHELL = ["/guard", "/guard/manifest.webmanifest", "/guard/icon-192.png", "/guard/icon-512.png", "/alarm.mp3"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== META).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put("/guard", copy));
          return r;
        })
        .catch(() => caches.match("/guard")),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return r;
          }),
      ),
    );
  }
});

// ── Web Push: the alarm with the app closed ──
// The push carries no data. Wake up, fetch this guard's newest alert, show it.
const LEVEL = { tense: "Tense", fight_likely: "Fight likely", fight: "Fight", calm: "Calm" };

async function readMeta() {
  try {
    const r = await (await caches.open(META)).match("/__meta");
    return r ? await r.json() : null;
  } catch {
    return null;
  }
}

async function newestAlert(meta) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const url = meta.api ? `${meta.api}/events?since=${encodeURIComponent(since)}` : "/api/mock/events";
  const r = await fetch(url, { cache: "no-store" });
  const list = await r.json();
  return list
    .filter((e) => e.pushed_to === meta.staff)
    .sort((a, b) => Date.parse(b.pushed_at || b.start_time) - Date.parse(a.pushed_at || a.start_time))[0];
}

self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      const meta = await readMeta();
      let title = "EarlyEye alarm";
      let body = "Open EarlyEye: you are the nearest guard.";
      let tag = "earlyeye-alarm";
      try {
        const a = meta && (await newestAlert(meta));
        if (a) {
          title = `${LEVEL[a.level] || "Alarm"} · ${a.location}`;
          body = `${meta.first ? meta.first + ", you're" : "You're"} the nearest guard. ${a.reason || ""}`.trim();
          tag = a.incident_id;
        }
      } catch {
        // offline or the API is asleep: still ring with the generic text
      }
      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        requireInteraction: true,
        vibrate: [600, 250, 600, 250, 900],
        icon: "/guard/icon-192.png",
        badge: "/guard/icon-192.png",
        data: { url: "/guard" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = wins.find((w) => new URL(w.url).pathname.startsWith("/guard"));
      if (open) return open.focus();
      return self.clients.openWindow("/guard");
    })(),
  );
});
