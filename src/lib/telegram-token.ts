/**
 * The gate's two signed cookies. Signed here, VERIFIED IN THE GATE.
 *
 * This header used to explain why the session cookie was checked for presence
 * only: "its signature is verified upstream on every API call, so a forged one
 * buys the shell of a page whose every data call then fails."
 *
 * That was false, and it was the most expensive sentence in this repo. It is
 * true of the routes that relay the customer token upstream. It is NOT true of
 * the catalogue routes — /api/catalog, /api/catalog/[id], /api/suggest,
 * /api/delivery-zone, /api/img — which run on the STORE API KEY alone and send
 * no customer token at all. The upstream has nothing to check, so it answers.
 *
 * Measured on the live members-only deployment, 2026-08-30, with a cookie
 * header consisting of two names and the letter x:
 *
 *     cookie: __Host-ybs_session=x; __Host-ybs_tg=x
 *     GET /api/catalog  →  200, 18,972 bytes, the entire catalogue
 *     GET /             →  200, 203,025 bytes, 113 products, full chrome
 *
 * 18,972 is the same number recorded in members-routes.ts as the leak that
 * motivated gating /api in the first place. That fix moved the bar from "no
 * cookie" to "any two cookie NAMES" — not to "a valid session".
 *
 * So both cookies are signed now and the gate verifies both. The session cookie
 * carries the PLATFORM's customer token, signed with a secret this storefront
 * does not hold and cannot check — so it gets a companion proof, minted here at
 * the moment sign-in succeeds and verified in the gate. The proof is not the
 * credential; it is this app's own attestation that it issued a session.
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


/**
 * MEMBER PROOF — this app's own signed attestation that it granted a session.
 *
 * Minted inside `setCustomerSession`/`setPendingSession` (src/lib/session.ts) so
 * no call site can forget it, cleared by `clearSession`. It carries no identity:
 * the customer token beside it is the credential, and duplicating identity here
 * would create a second thing that can disagree with the first.
 *
 * Required whenever MEMBERS_ONLY is on. Without JWT_SECRET the proof cannot be
 * minted and nobody gets in — the same fail-closed shape as a half-configured
 * Telegram gate, and for the same reason.
 */
export interface MemberProofClaim {
  /** Expiry, epoch seconds. */
  exp: number;
}

export const MEMBER_PROOF_COOKIE = "__Host-ybs_member";

export async function signMemberProof(
  claim: MemberProofClaim,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(claim)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Null for any failure — bad shape, bad signature, expired, unparseable. */
export async function verifyMemberProof(
  token: string | undefined,
  secret: string,
): Promise<MemberProofClaim | null> {
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
    const claim = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as MemberProofClaim;
    if (typeof claim?.exp !== "number") return null;
    if (claim.exp * 1000 <= Date.now()) return null;
    return claim;
  } catch {
    return null;
  }
}
