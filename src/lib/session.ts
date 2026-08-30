import "server-only";

import { cookies } from "next/headers";

/**
 * Customer session custody.
 *
 * The upstream customer token NEVER reaches browser JavaScript. It lives in an
 * httpOnly cookie that this server attaches to upstream calls as
 * `x-customer-token`. A token readable by JS is a token stealable by any XSS on
 * any page of the site, and it authorises placing orders.
 *
 * `__Host-` prefix: the browser itself then enforces Secure + Path=/ + no
 * Domain, so a sibling subdomain (or anything that can set cookies for the
 * registrable domain) cannot overwrite our session cookie with one of its own.
 *
 * Local development note: `Secure` is required by the prefix. Chrome, Firefox
 * and Safari all treat http://localhost as a secure context, so this works in
 * `pnpm dev` without an exception. It will NOT work over plain http on a LAN IP
 * — use localhost or a TLS tunnel.
 */

import {
  MEMBER_PROOF_COOKIE,
  signMemberProof,
} from "@/lib/telegram-token";
import { MEMBERS_ONLY } from "@/lib/site";

const TOKEN_COOKIE = "__Host-ybs_session";
/** Marks the token as the short-lived verified-phone kind, not a full session. */
const PENDING_COOKIE = "__Host-ybs_pending";
const AGE_COOKIE = "__Host-ybs_age";

const BASE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  // No `domain` — required for the __Host- prefix to be accepted.
};

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PENDING_MAX_AGE = 60 * 20; // the verified-phone token is short-lived upstream
const AGE_MAX_AGE = 60 * 60 * 24 * 30;

export type SessionKind = "customer" | "pending";

export async function readSessionToken(): Promise<{ token: string; kind: SessionKind } | null> {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  const kind: SessionKind = jar.get(PENDING_COOKIE)?.value === "1" ? "pending" : "customer";
  return { token, kind };
}

/** The token for calls that require a full customer session. */
export async function readCustomerToken(): Promise<string | null> {
  const s = await readSessionToken();
  return s && s.kind === "customer" ? s.token : null;
}

/** The token for /auth/register only. */
export async function readPendingToken(): Promise<string | null> {
  const s = await readSessionToken();
  return s && s.kind === "pending" ? s.token : null;
}

/**
 * Mint the app-signed proof that we granted this session, beside the token.
 *
 * The gate cannot verify the session cookie: it holds the PLATFORM's customer
 * token, signed with a secret this storefront does not have. So it checked the
 * cookie for presence, and `cookie: __Host-ybs_session=x` opened the whole shop
 * — 200, the full catalogue, 203,025 bytes of storefront (see the header of
 * src/lib/telegram-token.ts for the measurement).
 *
 * This proof carries no identity — the token beside it is the credential, and a
 * second copy of the identity is a second thing that can disagree. It is only
 * this app saying, over its own signature, "I issued a session here."
 *
 * Minted INSIDE the session setters rather than at the call sites, so a new
 * sign-in path cannot forget it. Only when MEMBERS_ONLY is on: an open
 * storefront has no gate to satisfy and gets no extra cookie.
 *
 * JWT_SECRET is REQUIRED on a members-only shop. Without it nothing can be
 * minted and nobody gets in — the same fail-closed shape as a half-configured
 * Telegram gate, and loud in the logs rather than silently open.
 */
async function setMemberProof(
  jar: Awaited<ReturnType<typeof cookies>>,
  maxAge: number,
): Promise<void> {
  if (!MEMBERS_ONLY) return;
  const secret = (process.env.JWT_SECRET || "").trim();
  if (!secret) {
    console.error(
      "[members] MEMBERS_ONLY is on but JWT_SECRET is unset — no session proof can be minted, so nobody can sign in. Set JWT_SECRET.",
    );
    return;
  }
  const proof = await signMemberProof(
    { exp: Math.floor(Date.now() / 1000) + maxAge },
    secret,
  );
  jar.set(MEMBER_PROOF_COOKIE, proof, { ...BASE, maxAge });
}

export async function setCustomerSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, token, { ...BASE, maxAge: SESSION_MAX_AGE });
  jar.set(PENDING_COOKIE, "", { ...BASE, maxAge: 0 });
  await setMemberProof(jar, SESSION_MAX_AGE);
}

/**
 * A PENDING session gets NO member proof. It is not admission.
 *
 * This token says "someone proved they control this phone". It does NOT say
 * "this phone is a customer here" — that is check ②, and a pending session is
 * precisely the state of having passed one check and not the other.
 *
 * It used to mint a proof, which meant a verified-phone-but-not-a-customer
 * visitor held every cookie `isAdmitted()` asks for and was let in. Check ② was
 * then enforced ENTIRELY by the platform's willingness to refuse the SMS —
 * across a repo boundary, with nothing asserting it locally. Point this
 * storefront at a deployment without that refusal and the shop opens to any
 * channel member with any phone, silently.
 *
 * The token is still set, because the register lane needs it on an OPEN
 * storefront. On a members-only shop that lane is gated anyway and this state
 * should never occur — and if it does, it now admits nobody.
 */
export async function setPendingSession(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, token, { ...BASE, maxAge: PENDING_MAX_AGE });
  jar.set(PENDING_COOKIE, "1", { ...BASE, maxAge: PENDING_MAX_AGE });
  jar.set(MEMBER_PROOF_COOKIE, "", { ...BASE, maxAge: 0 });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, "", { ...BASE, maxAge: 0 });
  jar.set(PENDING_COOKIE, "", { ...BASE, maxAge: 0 });
  jar.set(MEMBER_PROOF_COOKIE, "", { ...BASE, maxAge: 0 });
}

// ─────────────────────────── age gate ───────────────────────────

export async function hasPassedAgeGate(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(AGE_COOKIE)?.value === "1";
}

export async function setAgeGatePassed(): Promise<void> {
  const jar = await cookies();
  jar.set(AGE_COOKIE, "1", { ...BASE, maxAge: AGE_MAX_AGE });
}
