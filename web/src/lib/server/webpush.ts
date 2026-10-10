// Web Push from the laptop's demo server (no API): same protocol as api/services/webpush.py.
// Payload-less push signed with VAPID (ES256) using Node's crypto; the phone fetches its alert.
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars, else generated once into web/.local-vapid.json.
import { createPrivateKey, generateKeyPairSync, sign } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { readStore, updateStore } from "./local-store";

const FILE = path.join(process.cwd(), ".local-vapid.json");
const b64u = (b: Buffer) => b.toString("base64url");

interface Keys {
  publicKey: string; // uncompressed P-256 point, base64url
  privateKey: string; // 32-byte scalar, base64url
}
let cached: Keys | null = null;

export async function vapidKeys(): Promise<Keys> {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return (cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  try {
    return (cached = JSON.parse(await fs.readFile(FILE, "utf8")) as Keys);
  } catch {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string; d: string };
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
    cached = { publicKey: b64u(pub), privateKey: jwk.d };
    await fs.writeFile(FILE, JSON.stringify(cached)).catch(() => {});
    return cached;
  }
}

function vapidHeader(endpoint: string, k: Keys): string {
  const pub = Buffer.from(k.publicKey, "base64url");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: k.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const u = new URL(endpoint);
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(
    Buffer.from(
      JSON.stringify({
        aud: `${u.protocol}//${u.host}`,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: process.env.VAPID_SUBJECT ?? "mailto:earlyeye@example.com",
      }),
    ),
  );
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.publicKey}`;
}

/** Wake every phone subscribed for this call sign. Never throws. */
export async function notify(staff: string | null | undefined): Promise<number> {
  if (!staff) return 0;
  const { pushSubs } = await readStore();
  const mine = Object.values(pushSubs ?? {}).filter((s) => s.staff === staff);
  if (!mine.length) return 0;
  const k = await vapidKeys();
  let sent = 0;
  for (const s of mine) {
    try {
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: vapidHeader(s.endpoint, k), TTL: "120", Urgency: "high", "Content-Length": "0" },
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 404 || r.status === 410) await updateStore((st) => delete st.pushSubs[s.endpoint]);
      else if (r.ok) sent++;
    } catch {
      // offline: the app-open alarm still works
    }
  }
  return sent;
}
