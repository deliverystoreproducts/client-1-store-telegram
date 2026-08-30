/**
 * What a signed-out visitor may reach when MEMBERS_ONLY is on.
 *
 * The answer is now: NOTHING. Not a page, not an API route, except the four
 * endpoints below that signing in is physically impossible without.
 *
 * Pure module, no imports: read by `src/proxy.ts` in the EDGE runtime.
 */

/**
 * Request header the proxy stamps on a members-gate rewrite, so the root layout
 * knows one happened and renders the gate INSTEAD of the shop.
 *
 * Without it the rewrite is silent: the layout cannot tell "navigated to
 * /signin" from "rewritten to /signin from /product/1", so it rendered the
 * sign-in page inside the full chrome — promo bar, header, nav, search, Cart —
 * advertising the shop to exactly the people the gate exists to keep out.
 *
 * The proxy DELETES any inbound copy before setting it, so a client cannot
 * forge it. Same discipline as OPEN_ROUTE_HEADER, and for the same reason.
 */
export const MEMBERS_GATE_HEADER = "x-ybs-members-gate";

/**
 * NO page is reachable without a session. Every path a signed-out visitor asks
 * for answers with the same white sign-in screen.
 *
 * This list used to hold `/privacy` and `/terms`, open on the CalOPPA reasoning
 * that B&P § 22575 wants a privacy policy "conspicuously posted" and that this
 * gate, because it collects a phone number, is a point of collection. The owner
 * has ruled that no page may open without login. The notice did not disappear:
 * it moved onto the gate itself, as a sentence rather than a link, so the
 * disclosure still sits at the point of collection and there is no longer a
 * route that serves anything to a stranger. Both pages still exist and are
 * reachable the moment someone is signed in.
 *
 * The list is empty and should stay empty. Adding an entry publishes that page
 * to the whole internet — and on this storefront "published" means whatever it
 * renders ships inside the RSC flight payload, readable from view-source.
 */
export const MEMBER_OPEN_ROUTES = [] as const;

export function isMemberOpenRoute(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (MEMBER_OPEN_ROUTES as readonly string[]).includes(p);
}

/**
 * The API routes a signed-out request may still reach, and why each one has to
 * be here. Everything else under /api answers 401.
 *
 * This list exists because the gate did not used to cover /api at all. The
 * matcher excluded it on the reasoning — written into src/proxy.ts — that those
 * routes are "same-origin fetches from pages that are already gated". They are
 * not: they are URLs, and `GET /api/catalog` returned the entire product
 * catalogue to anyone who asked. Measured on the live members-only deployment
 * on 2026-08-30: 200, 18,972 bytes of products, no cookie of any kind. The page
 * gate was airtight and the data was served beside it.
 *
 * The test for this list is not "does the login flow use it" but "does a
 * stranger holding this URL learn anything about the shop or its customers".
 *
 *   /api/health         Railway's healthcheckPath (railway.toml). Gate it and
 *                       every deploy fails its health probe and rolls back.
 *                       Returns a status and an uptime — nothing about the shop.
 *   /api/auth/telegram  Mints the channel cookie. Runs with NO cookies at all,
 *                       by definition — it is the first request the Mini App
 *                       makes. Refuses everyone unless initData carries a valid
 *                       HMAC and the user is in the channel.
 *   /api/auth/send-code Step one of sign-in. When the Telegram gate is on this
 *                       route requires a VERIFIED channel cookie (signature
 *                       checked, not merely present), and the upstream refuses a
 *                       phone that is not already a customer before any SMS is
 *                       sent.
 *   /api/auth/verify-code  Step two. Same reasoning.
 *
 * Deliberately NOT here: /api/auth/me, /api/auth/logout, /api/auth/register,
 * /api/age, /api/img. The gate screen never calls them — only the signed-in
 * chrome does, and it has a session by then.
 */
export const API_BOOTSTRAP_ROUTES = [
  "/api/health",
  "/api/auth/telegram",
  "/api/auth/send-code",
  "/api/auth/verify-code",
] as const;

export function isApiBootstrapRoute(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (API_BOOTSTRAP_ROUTES as readonly string[]).includes(p);
}
