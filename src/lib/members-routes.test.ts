import { describe, expect, it } from "vitest";
import {
  API_BOOTSTRAP_ROUTES,
  MEMBER_OPEN_ROUTES,
  isApiBootstrapRoute,
  isMemberOpenRoute,
} from "@/lib/members-routes";

/**
 * The members gate is an ALLOW-LIST, and the allow-list is EMPTY.
 *
 * These tests guard the quiet failure. Adding a page here to fix a redirect
 * during development would publish it — and on this storefront "published"
 * means whatever it renders ships inside the RSC flight payload, readable from
 * view-source by anyone who never signed in. The whole point of this shop is
 * that it does not.
 */

/** Everything that renders catalogue or customer data. Extend when a page is added. */
const PRIVATE = [
  "/",
  "/products",
  "/brands",
  "/brand/12",
  "/category/5",
  "/product/99",
  "/deals",
  "/deal/7",
  "/cart",
  "/checkout",
  "/account",
  "/track",
  "/track/abc123",
  // Sign-in runs BEFORE the age gate, so a signed-out visitor must not reach
  // the age screen either — it would tell a stranger a cannabis shop is here.
  "/age",
  "/faq",
  "/returns",
  "/contact",
  // The legal notices are private too. They were the last two exceptions, open
  // on CalOPPA reasoning; the notice now lives on the gate screen itself as a
  // sentence, so there is no route that serves anything to a stranger.
  "/privacy",
  "/terms",
  // Not even the gate's own path is "open" — the proxy stamps the gate header
  // and renders it, rather than consulting this list.
  "/signin",
];

describe("members-only allow-list", () => {
  it.each(PRIVATE)("keeps %s behind the sign-in gate", (route) => {
    expect(isMemberOpenRoute(route)).toBe(false);
  });

  it("is empty, and stays empty", () => {
    // The tripwire. Every entry added here publishes a page to the internet.
    expect([...MEMBER_OPEN_ROUTES]).toEqual([]);
  });

  it("does not open a route by prefix or trailing slash", () => {
    expect(isMemberOpenRoute("/signin-preview")).toBe(false);
    expect(isMemberOpenRoute("/privacy/products")).toBe(false);
    expect(isMemberOpenRoute("/products/")).toBe(false);
  });
});

/**
 * The API allow-list. This one is not empty and cannot be: signing in is
 * impossible without it, and Railway's health probe would fail every deploy.
 *
 * It exists because /api was not gated at all — the matcher excluded it, and
 * `GET /api/catalog` returned the entire product catalogue with no cookie of
 * any kind (measured live, 2026-08-30: 200, 18,972 bytes). These tests pin the
 * exact four, because the danger is a fifth being added casually.
 */
describe("API bootstrap allow-list", () => {
  const MUST_BE_GATED = [
    "/api/catalog",
    "/api/catalog/300004864",
    "/api/suggest",
    "/api/coupons",
    "/api/delivery-zone",
    "/api/cart/price",
    "/api/checkout",
    "/api/orders",
    "/api/orders/track/abc",
    "/api/address",
    "/api/img/foo.jpg",
    "/api/age",
    // The gate screen never calls these; only the signed-in chrome does.
    "/api/auth/me",
    "/api/auth/logout",
    // Registration is unreachable in a members-only shop by construction — the
    // upstream refuses an unknown phone before any code is sent.
    "/api/auth/register",
  ];

  it.each(MUST_BE_GATED)("refuses %s to a signed-out request", (route) => {
    expect(isApiBootstrapRoute(route)).toBe(false);
  });

  it.each([...API_BOOTSTRAP_ROUTES])("lets %s through", (route) => {
    expect(isApiBootstrapRoute(route)).toBe(true);
  });

  it("is exactly the four that sign-in and the health probe require", () => {
    expect([...API_BOOTSTRAP_ROUTES].sort()).toEqual([
      "/api/auth/send-code",
      "/api/auth/telegram",
      "/api/auth/verify-code",
      "/api/health",
    ]);
  });

  it("does not open an API route by prefix", () => {
    expect(isApiBootstrapRoute("/api/health/secrets")).toBe(false);
    expect(isApiBootstrapRoute("/api/auth/telegram-admin")).toBe(false);
  });
});
