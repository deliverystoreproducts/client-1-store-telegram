import type { MetadataRoute } from "next";
import { MEMBERS_ONLY } from "@/lib/site";

/**
 * There was no robots route, so `GET /robots.txt` fell through to Next's
 * dynamic 404 — which renders through the ROOT LAYOUT. That path is on the
 * proxy's exclusion list, so no gate had run, and the layout served the full
 * branded shop to anyone: 22,180 bytes naming the store, its tagline, and
 * "Licensed California cannabis retailer". Every crawler and scanner requests
 * this path automatically; no attacker had to think of anything.
 *
 * The layout now fails closed on an unstamped request, so that hole is shut
 * either way. This route exists so the cleanest vector serves a real file
 * rather than a 404 that has to be defended.
 *
 * A members-only shop disallows everything: it is private by construction, and
 * SEO_INDEX has nothing to say about a shop with no public pages.
 */
export default function robots(): MetadataRoute.Robots {
  if (MEMBERS_ONLY || process.env.SEO_INDEX !== "on") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/" } };
}
