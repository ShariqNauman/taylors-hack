// Web Push for the guard app: the alarm reaches the phone even when EarlyEye is closed.
// The phone subscribes on Start my shift; the API (or the laptop's demo server) wakes it on every push.
// Needs https (the deployed link, or a tunnel to the laptop), and on iPhone the app added to the Home Screen.
import { API_RESOURCES_HAS_EVENTS, API_URL, usingMock } from "./api";

export type PushState = "on" | "off" | "blocked" | "install-first" | "unsupported" | "not-configured" | "needs-https";

const META_CACHE = "earlyeye-guard-meta";
const base = () => (usingMock || !API_RESOURCES_HAS_EVENTS ? "/api" : API_URL);

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}
function installed() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const r = await navigator.serviceWorker.getRegistration("/guard");
  return r ?? (await navigator.serviceWorker.register("/guard-sw.js", { scope: "/guard" }).catch(() => null));
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "needs-https";
  if (isIos() && !installed()) return "install-first";
  if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const r = await navigator.serviceWorker.getRegistration("/guard");
  const sub = await r?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Call straight from a tap (Start my shift / Turn on): the browser only asks inside a user gesture. */
export async function enablePush(staff: string, first: string): Promise<PushState> {
  // Checks that need no waiting, then the permission prompt first: iPhone only shows it
  // when it is asked straight from the tap.
  if (!window.isSecureContext) return "needs-https";
  if (isIos() && !installed()) return "install-first";
  if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  const r = await registration();
  if (!r) return "unsupported";
  let key: string;
  try {
    const k = await fetch(`${base()}/push/key`, { cache: "no-store" });
    if (!k.ok) return "not-configured";
    key = ((await k.json()) as { public_key: string }).public_key;
  } catch {
    return "not-configured";
  }
  await navigator.serviceWorker.ready;
  const sub =
    (await r.pushManager.getSubscription()) ??
    (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  const ok = await fetch(`${base()}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staff, subscription: sub.toJSON() }),
  }).then((x) => x.ok, () => false);
  // The service worker reads this to know whose alert to fetch when a push arrives.
  try {
    const c = await caches.open(META_CACHE);
    await c.put("/__meta", new Response(JSON.stringify({ staff, first, api: base() === "/api" ? "" : API_URL })));
  } catch {
    // no Cache Storage: the notification falls back to generic text
  }
  return ok ? "on" : "not-configured";
}

/** End my shift / switch person: this phone stops getting alarms. */
export async function disablePush(): Promise<void> {
  try {
    const r = await navigator.serviceWorker?.getRegistration("/guard");
    const sub = await r?.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${base()}/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe();
    await (await caches.open(META_CACHE)).delete("/__meta");
  } catch {
    // nothing to undo
  }
}
