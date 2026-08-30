import { NextResponse, type NextRequest } from "next/server";
import { OPEN_ROUTE_HEADER, isOpenRoute } from "@/lib/open-routes";
import { MEMBERS_GATE_HEADER, isMemberOpenRoute } from "@/lib/members-routes";

/**
 * THE AGE GATE, ENFORCED BEFORE ANY PAGE CODE RUNS.
 *
 * (`src/proxy.ts` is Next 16's name for what used to be `middleware.ts` — same
 * hook, default export instead of a named one.)
 *
 * Why this exists here and not just as a branch in the layout:
 *
 * A layout that renders `<AgeGate/>` instead of `{children}` hides the store
 * VISUALLY, but the App Router still renders the page segment and serialises it
 * into the RSC flight payload inlined in the HTML. Measured on this app before
 * this file existed: a request with an empty cookie jar returned the gate on
 * screen and all 24 products — names, prices, categories, product URLs — inside
 * `<script>self.__next_f.push(...)</script>`. View-source defeated the gate
 * completely, and the response was 62 KB instead of 11 KB. An age gate that only
 * wins in the pixels is not a control.
 *
 * So the decision is made here, before a route is chosen: without the
 * confirmation cookie every navigable URL is REWRITTEN to `/age`, so the catalog
 * page function is never invoked and there is nothing to serialise.
 *
 * Rewrite, not redirect, on purpose — the address bar keeps the URL the visitor
 * asked for, so confirming lands them on the product they clicked rather than
 * dumping them on the home page.
 *
 * This is a routing control only. It reads one cookie. It does not touch data
 * fetching, the upstream client or the API key.
 */

/** Mirrors `AGE_COOKIE` in src/lib/session.ts. This file cannot import that
 *  module (it is `server-only` and Node-flavoured), so the name is duplicated
 *  deliberately — change both together. */
const AGE_COOKIE = "__Host-ybs_age";

const GATE_PATH = "/age";

/**
 * MEMBERS-ONLY: the second gate.
 *
 * Same mechanism as the age gate above and for the same measured reason — a
 * layout that renders a sign-in screen INSTEAD of children still renders the
 * page segment and serialises it into the RSC flight payload inlined in the
 * HTML. View-source then defeats it completely. A gate that only wins in the
 * pixels is not a control, and for this shop "not rendered at all" is the
 * requirement, not a nicety.
 *
 * So the decision is made HERE, before a route is chosen, and the response for
 * a signed-out visitor contains the sign-in screen and nothing else.
 *
 * The cookie is only checked for PRESENCE. Its signature is verified upstream
 * on every API call, so a forged cookie buys a visitor the shell of a page
 * whose every data call then fails — it does not buy them data. Verifying the
 * JWT in middleware would mean shipping the secret to the edge runtime for no
 * additional protection.
 */
const SIGNIN_PATH = "/signin";

const SESSION_COOKIE = "__Host-ybs_session";

/**
 * TELEGRAM CHANNEL GATE — check ① of two.
 *
 * Presence is enough HERE because the token is signed and the API routes that
 * serve real data are not reachable without check ② (the customer session,
 * whose signature the platform verifies on every call). The signature itself is
 * verified where it decides something: `/api/auth/telegram` mints it, and any
 * route that trusts it must call verifyTelegramToken.
 *
 * Middleware deliberately does NOT verify it, for the reason already written
 * above about the session cookie: that would mean shipping JWT_SECRET into the
 * edge runtime. A forged cookie gets a visitor as far as the phone form — which
 * then refuses them unless they are a real customer of this tenant.
 */
const TELEGRAM_COOKIE = "__Host-ybs_tg";

function telegramGateEnabled(): boolean {
  return (process.env.TELEGRAM_GATE || "").trim().toLowerCase() === "on";
}

/**
 * Reachable without a session when MEMBERS_ONLY is on.
 *
 * Deliberately tiny. /signin is the gate itself; the legal notices are open for
 * the same CalOPPA reason they bypass the age gate — a privacy policy behind a
 * login is not "conspicuously posted", and the link on the sign-in screen would
 * lead back to the sign-in screen.
 */
/**
 * Read straight from the environment rather than importing `@/lib/site`.
 * Middleware runs in the edge runtime; it should not pull in the module of
 * browser constants just to read one flag.
 */
function membersOnlyEnabled(): boolean {
  return (process.env.MEMBERS_ONLY || "").trim().toLowerCase() === "on";
}

export default function proxy(req: NextRequest) {
  const passed = req.cookies.get(AGE_COOKIE)?.value === "1";
  const { pathname } = req.nextUrl;

  // The legal notices stay reachable without answering the gate — see
  // src/lib/open-routes.ts for why. The header is how the root layout learns
  // that THIS file made that decision; any inbound copy is deleted first, so a
  // client cannot claim it for /product/1.
  const headers = new Headers(req.headers);
  headers.delete(OPEN_ROUTE_HEADER);
  headers.delete(MEMBERS_GATE_HEADER);
  const open = isOpenRoute(pathname);
  if (open) headers.set(OPEN_ROUTE_HEADER, "1");
  const forward = { request: { headers } };

  // SIGN-IN FIRST, then age. A members-only shop shows nothing at all to a
  // stranger — not even the age question, which would tell them a shop is here.
  // Once they are in, the age gate is asked of them like any other customer.
  const members = membersGate(req, forward);
  if (members) return members;

  if (passed) {
    // Nothing left to answer; /age is not a page anyone should sit on.
    if (pathname === GATE_PATH) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next(forward);
  }

  if (pathname === GATE_PATH || open) return NextResponse.next(forward);

  return NextResponse.rewrite(new URL(GATE_PATH, req.url), forward);
}

/**
 * The members gate. Runs BEFORE the age gate.
 *
 * Returns a response when it has an opinion, and `null` when it does not — so
 * the caller falls through to the age gate. That is the difference between "the
 * shop is private and you are not in it" and "you are in; now answer the age
 * question like everyone else".
 *
 * ORDER: sign-in first. A private shop shows a stranger nothing at all, and an
 * age prompt is not nothing — it tells them a cannabis shop is at this address.
 * Once signed in, the age gate applies exactly as it does on every other
 * storefront.
 *
 * A NO-OP when MEMBERS_ONLY is off, so every other storefront behaves as before.
 * That is the whole reason this is a flag in shared code rather than a fork.
 */
function membersGate(
  req: NextRequest,
  forward: { request: { headers: Headers } },
): NextResponse | null {
  if (!membersOnlyEnabled()) return null;

  const { pathname } = req.nextUrl;

  // BOTH checks, when the Telegram gate is on. Channel membership is not a
  // purchase history and a customer is not necessarily in the channel, so
  // neither substitutes for the other.
  const inChannel = !telegramGateEnabled() || !!req.cookies.get(TELEGRAM_COOKIE)?.value;
  const signedIn = inChannel && !!req.cookies.get(SESSION_COOKIE)?.value;

  if (signedIn) {
    // Sitting on /signin with a live session is a dead end; send them shopping.
    if (pathname === SIGNIN_PATH) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return null; // in — let the age gate have its turn
  }

  if (isMemberOpenRoute(pathname)) return null;

  // REWRITE, not redirect: the URL they asked for stays in the address bar, so
  // signing in returns them to it and a shared link still works. A redirect
  // would throw the destination away and land everyone on the same page.
  //
  // The header is what makes the layout render the gate INSTEAD of the shop.
  // Without it the rewrite is silent and /signin renders inside the full chrome.
  const headers = new Headers(forward.request.headers);
  headers.set(MEMBERS_GATE_HEADER, "1");
  return NextResponse.rewrite(new URL(SIGNIN_PATH, req.url), { request: { headers } });
}


export const config = {
  /**
   * Everything a person can navigate to. Deliberately NOT matched:
   *   /api/*   — `/api/age` is how the gate is answered, and the other routes
   *              are same-origin fetches from pages that are already gated.
   *   /_next/* — build output.
   *   /fonts/* — the self-hosted webfaces; the gate itself needs them.
   *   PWA plumbing — manifest, sw.js, offline page, icons: fetched by the
   *     browser/worker without a person navigating; rewriting any of them to
   *     the gate's HTML breaks install (wrong MIME) while gating nothing —
   *     none of them carry catalogue data.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|fonts|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|sw.js|offline.html|icons/|splash/|apple-icon.png|dcc-safer-use-brochure.pdf).*)",
  ],
};
