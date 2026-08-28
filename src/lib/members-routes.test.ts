import { describe, expect, it } from "vitest";
import { MEMBER_OPEN_ROUTES, isMemberOpenRoute } from "@/lib/members-routes";

/**
 * The members gate is an ALLOW-LIST: src/proxy.ts rewrites everything not in
 * this list to /signin, before a route is chosen and before anything renders.
 *
 * These tests guard the quiet failure. Adding a page to the allow-list to fix a
 * redirect during development would publish it — and on this storefront
 * "published" means the catalogue ships inside the RSC flight payload, readable
 * from view-source by anyone who never signed in. The whole point of this shop
 * is that it does not.
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
  "/faq",
  "/returns",
  "/contact",
];

describe("members-only allow-list", () => {
  it.each(PRIVATE)("keeps %s behind the sign-in gate", (route) => {
    expect(isMemberOpenRoute(route)).toBe(false);
  });

  it.each([...MEMBER_OPEN_ROUTES])("lets %s through", (route) => {
    expect(isMemberOpenRoute(route)).toBe(true);
  });

  it("stays limited to the gate itself and the legal notices", () => {
    // A tripwire: widening this should have to be done twice, in code and here.
    expect([...MEMBER_OPEN_ROUTES].sort()).toEqual(["/age", "/privacy", "/signin", "/terms"]);
  });

  it("does not open a route by prefix", () => {
    expect(isMemberOpenRoute("/signin-preview")).toBe(false);
    expect(isMemberOpenRoute("/terms-and-menu")).toBe(false);
    expect(isMemberOpenRoute("/privacy/products")).toBe(false);
  });

  it("treats a trailing slash as the same route", () => {
    expect(isMemberOpenRoute("/signin/")).toBe(true);
    expect(isMemberOpenRoute("/products/")).toBe(false);
  });

  it("never opens /contact — it is open to the AGE gate but not to this one", () => {
    // Deliberate difference: /contact carries no product data so the age gate
    // lets it through, but a members-only shop should not advertise its support
    // channel to people who cannot buy from it.
    expect(isMemberOpenRoute("/contact")).toBe(false);
  });
});
