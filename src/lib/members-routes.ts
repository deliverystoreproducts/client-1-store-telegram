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
 * sign-in screen would otherwise lead back to the sign-in screen. `/age` is
 * open because the age question is asked of everyone, before this gate.
 *
 * Nothing here renders catalogue data. That is the test for adding to this
 * list, and it is the only test — a page that lists products does not belong,
 * however convenient.
 *
 * Pure module, no imports: read by `src/proxy.ts` in the EDGE runtime.
 */

export const MEMBER_OPEN_ROUTES = ["/signin", "/privacy", "/terms", "/age"] as const;

export function isMemberOpenRoute(pathname: string): boolean {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (MEMBER_OPEN_ROUTES as readonly string[]).includes(p);
}
