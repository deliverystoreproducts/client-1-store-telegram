/**
 * The Telegram membership token — signed here, verified in the EDGE runtime.
 *
 * WHY THIS IS SIGNED AND THE SESSION COOKIE IS NOT.
 *
 * `src/proxy.ts` checks the customer session cookie for presence only, and that
 * is safe: its signature is verified upstream on every API call, so a forged one
 * buys the shell of a page whose every data call then fails.
 *
 * This cookie has no upstream. It is the ONLY record that Telegram said this
 * person is in the channel. If the gate merely checked that it existed, any real
 * customer could mint one and walk past the channel check — which is the whole
 * of requirement ③a. So it is signed, and the gate verifies it.
 *
 * Web Crypto rather than node:crypto, because the verify runs in middleware.
 * No dependency: `crypto.subtle` is available in both runtimes.
 *
 * Format: base64url(payload) "." base64url(HMAC-SHA256(payload))
 */

export interface TelegramClaim {
  /** Telegram user id that passed getChatMember. */
  tg: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  // Backed by a plain ArrayBuffer on purpose: `BufferSource` excludes
  // SharedArrayBuffer, and an unannotated Uint8Array widens to ArrayBufferLike.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signTelegramToken(claim: TelegramClaim, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(claim)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Returns the claim, or null for ANY failure — bad shape, bad signature,
 * expired, unparseable. A caller must never be able to distinguish them: the
 * only useful answer is "this token does not admit you".
 *
 * `crypto.subtle.verify` is constant-time, which is why the comparison is not
 * hand-rolled.
 */
export async function verifyTelegramToken(
  token: string | undefined,
  secret: string,
): Promise<TelegramClaim | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      b64urlDecode(sig),
      enc.encode(body),
    );
    if (!ok) return null;

    const claim = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TelegramClaim;
    if (typeof claim?.tg !== "number" || typeof claim?.exp !== "number") return null;
    // Expiry is checked AFTER the signature, so an expired-but-valid token and a
    // forged one take the same path out.
    if (claim.exp * 1000 <= Date.now()) return null;
    return claim;
  } catch {
    return null;
  }
}

/** Cookie name. `__Host-` makes the browser enforce Secure + Path=/ + no Domain. */
export const TELEGRAM_COOKIE = "__Host-ybs_tg";

/** Seven days. Short enough that leaving the channel costs access reasonably soon. */
export const TELEGRAM_MAX_AGE = 60 * 60 * 24 * 7;
