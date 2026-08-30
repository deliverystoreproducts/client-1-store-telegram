import { NextResponse, type NextRequest } from "next/server";
import { OPEN_ROUTE_HEADER, isOpenRoute } from "@/lib/open-routes";
import { MEMBERS_GATE_HEADER, isApiBootstrapRoute } from "@/lib/members-routes";

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

  // OPEN_ROUTE_HEADER is the AGE gate's exception list — the legal notices stay
  // reachable without answering the age question (src/lib/open-routes.ts). It
  // has no bearing on the members gate, which opens nothing. The header is how
  // the root layout learns THIS file made that decision; any inbound copy is
  // deleted first, so a client cannot claim it for /product/1.
  const headers = new Headers(req.headers);
  headers.delete(OPEN_ROUTE_HEADER);
  headers.delete(MEMBERS_GATE_HEADER);
  const open = isOpenRoute(pathname);
  if (open) headers.set(OPEN_ROUTE_HEADER, "1");
  const forward = { request: { headers } };

  // API routes are DATA, and they are answered before either gate below can
  // rewrite them. Two separate reasons, both learned the hard way:
  //
  //   1. They were not gated at all. The matcher excluded /api on the reasoning
  //      that these are "same-origin fetches from pages that are already
  //      gated". They are URLs. `GET /api/catalog` served the whole catalogue —
  //      200, 18,972 bytes, no cookie — from the live members-only shop, right
  //      next to a page gate that was airtight.
  //   2. They must never be REWRITTEN. Answering a fetch for JSON with the
  //      gate's HTML is exactly what made telegram-web-app.js unexecutable: the
  //      caller gets 200 and a content-type that lies, and fails somewhere far
  //      away from the cause. A refusal has to look like a refusal, so this
  //      returns 401 JSON.
  if (pathname.startsWith("/api/")) return apiGate(req, forward);

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

  // NOTHING is open. Every path answers with the same white screen — /privacy
  // and /terms included, which were the last two exceptions. See
  // MEMBER_OPEN_ROUTES for what happened to the privacy notice they carried.
  //
  // REWRITE, not redirect: the URL they asked for stays in the address bar, so
  // signing in returns them to it and a shared link still works. A redirect
  // would throw the destination away and land everyone on the same page.
  //
  // The header is what makes the layout render the gate INSTEAD of the shop.
  // Without it the rewrite is silent and /signin renders inside the full chrome.
  const headers = new Headers(forward.request.headers);
  headers.set(MEMBERS_GATE_HEADER, "1");

  // Already on /signin: stamp the header and let it render, rather than
  // rewriting a path to itself.
  if (pathname === SIGNIN_PATH) return NextResponse.next({ request: { headers } });

  return NextResponse.rewrite(new URL(SIGNIN_PATH, req.url), { request: { headers } });
}

/**
 * The gate for /api/*.
 *
 * A NO-OP when MEMBERS_ONLY is off, so every open storefront — YB,
 * client-1-store — behaves exactly as it did before this existed.
 *
 * When it is on, the same two cookies decide as for pages, and for the same
 * reason: channel membership is not a purchase history and a customer is not
 * necessarily in the channel, so neither substitutes for the other.
 *
 * Presence, not signature — same trade as the page gate. Verifying either token
 * here would ship JWT_SECRET into the edge runtime, and it buys nothing: every
 * route behind this one re-checks the session against the platform on the call
 * it actually makes, so a forged cookie gets an empty answer rather than data.
 */
function apiGate(
  req: NextRequest,
  forward: { request: { headers: Headers } },
): NextResponse {
  if (!membersOnlyEnabled()) return NextResponse.next(forward);

  const { pathname } = req.nextUrl;
  if (isApiBootstrapRoute(pathname)) return NextResponse.next(forward);

  const inChannel = !telegramGateEnabled() || !!req.cookies.get(TELEGRAM_COOKIE)?.value;
  const signedIn = inChannel && !!req.cookies.get(SESSION_COOKIE)?.value;
  if (signedIn) return NextResponse.next(forward);

  // Same shape as the upstream's own refusal, so a client that already handles
  // an expired session handles this without a second code path.
  return NextResponse.json(
    { error: "not_authenticated", message: "Please sign in." },
    { status: 401 },
  );
}


export const config = {
  /**
   * Everything a person can navigate to. Deliberately NOT matched:
   *   /api/*   — by THIS entry. It has its own, above, because an API route
   *              needs a JSON refusal rather than a rewrite to the gate's HTML.
   *              This line used to read "same-origin fetches from pages that
   *              are already gated", which was wrong: they are URLs, and
   *              /api/catalog served the entire catalogue to anyone.
   *   /_next/* — build output.
   *   /fonts/* — the self-hosted webfaces; the gate itself needs them.
   *   PWA plumbing — manifest, sw.js, offline page, icons: fetched by the
   *     browser/worker without a person navigating; rewriting any of them to
   *     the gate's HTML breaks install (wrong MIME) while gating nothing —
   *     none of them carry catalogue data.
   *   telegram-web-app.js — the vendored Mini App SDK, and it was MISSED when
   *     the Telegram gate shipped. The gate rewrote it to /signin, so the
   *     browser received `content-type: text/html` for a .js URL, `nosniff`
   *     correctly refused to execute it, `window.Telegram` never existed, and
   *     boot() concluded there was no initData. The result: the gate blocked
   *     everyone INCLUDING real channel members, and looked identical whether
   *     opened from Telegram or a browser — so it read as "the check is too
   *     strict" rather than "the SDK is missing".
   *
   *     ANY new static asset must be added here. The failure is silent: no
   *     error, no 404, just a file that quietly is not what it says it is.
   */
  matcher: [
    // /api IS matched now — see apiGate. It is a separate entry rather than a
    // hole punched in the negative lookahead below, so the two rules stay
    // legible: this one says "every API route", that one says "every page
    // except the static assets".
    "/api/:path*",
    "/((?!api|_next/static|_next/image|fonts|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|sw.js|telegram-web-app.js|offline.html|icons/|splash/|apple-icon.png|dcc-safer-use-brochure.pdf).*)",
  ],
};
