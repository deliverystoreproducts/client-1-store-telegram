/**
 * What a signed-out visitor may reach when MEMBERS_ONLY is on.
 *
 * Deliberately tiny, and an ALLOW-LIST for the same reason the age gate is one:
 * a new page is private by default, and making it public has to be a decision
 * somebody wrote down. A deny-list leaks every page nobody remembered.
 *
 * `/signin` is the gate itself. The legal notices are open for the same CalOPPA
 * reason they bypass the age gate — B&P § 22575 wants the privacy policy
 * "conspicuously posted", and a policy behind a login is not; the link on the
 * sign-in screen would otherwise lead back to the sign-in screen. The gate
 * collects a phone number, so it IS a point of collection and that link is not
 * optional.
 *
 * Nothing here renders catalogue data. That is the test for adding to this
 * list, and it is the only test — a page that lists products does not belong,
 * however convenient.
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
 * `/age` is NOT here. Sign-in runs first, so a signed-out visitor never reaches
 * the age screen — an age prompt is not "nothing": it tells a stranger that a
 * cannabis shop is at this address. Once signed in they meet it like any other
 * customer.
 */
export const MEMBER_OPEN_ROUTES = ["/signin", "/privacy", "/terms"] as const;

export function isMemberOpenRoute(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (MEMBER_OPEN_ROUTES as readonly string[]).includes(p);
}
