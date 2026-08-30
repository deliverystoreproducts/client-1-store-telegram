import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/**
 * The proxy's matcher, tested as the shipped regex rather than a copy of it.
 *
 * WHY THIS FILE EXISTS. The exclusion list was written as unanchored prefixes:
 * `robots.txt` also excluded `robots.txtZZ`, `api` excluded `apiZZ`. Any
 * suffixed variant skipped the proxy entirely, Next rendered its 404 through the
 * root layout, and the layout — which had no way to tell "the proxy let you
 * through" from "the proxy never ran" — served the whole branded shop. A plain
 * `GET /robots.txt`, which every crawler sends unprompted, returned 22,180 bytes
 * naming the store; one forged `x-ybs-open-route: 1` made it 27,590 bytes of
 * full shopfront.
 *
 * Two defences now: the layout fails closed on an unstamped request, and these
 * tests keep the matcher itself honest. Either alone would have stopped it.
 */

const PAGE_MATCHER = (config.matcher as string[]).find((m) => m.includes("?!"));

function matchesProxy(pathname: string): boolean {
  if (!PAGE_MATCHER) throw new Error("the negative-lookahead matcher is gone");
  return new RegExp(`^${PAGE_MATCHER}$`).test(pathname);
}

/** Files that must NEVER be rewritten to the gate's HTML — wrong MIME, silent break. */
const MUST_SKIP = [
  "/api/catalog",
  "/_next/static/chunks/main.js",
  "/_next/image",
  "/fonts/inter.woff2",
  "/favicon.ico",
  "/icon.svg",
  "/robots.txt",
  "/manifest.webmanifest",
  "/sw.js",
  "/telegram-web-app.js",
  "/offline.html",
  "/icons/icon-192.png",
  "/splash/430x932@3x-dark.png",
  "/apple-icon.png",
  "/dcc-safer-use-brochure.pdf",
];

/** The suffix trick. Every one of these bypassed the proxy and leaked the shop. */
const SUFFIXED = [
  "/robots.txtZZ",
  "/sw.jsZZ",
  "/favicon.icoZZ",
  "/apiZZ",
  "/fontsZZ",
  "/icon.svgZZ",
  "/apple-icon.pngZZ",
  "/manifest.webmanifestZZ",
  "/offline.htmlZZ",
  "/telegram-web-app.jsZZ",
  "/dcc-safer-use-brochure.pdfZZ",
  "/_next/imageZZ",
  // The unescaped dots matched any character, so these got through too.
  "/faviconXico",
  "/robotsXtxt",
  "/swXjs",
];

describe("proxy matcher", () => {
  it.each(MUST_SKIP)("leaves %s to be served as itself", (path) => {
    expect(matchesProxy(path)).toBe(false);
  });

  it.each(SUFFIXED)("does NOT let %s skip the proxy", (path) => {
    expect(matchesProxy(path)).toBe(true);
  });

  it.each(["/", "/products", "/product/99", "/cart", "/privacy", "/signin", "/age"])(
    "gates the page %s",
    (path) => {
      expect(matchesProxy(path)).toBe(true);
    },
  );

  it("still matches /api explicitly through its own entry", () => {
    // /api is excluded from the lookahead above and handled by "/api/:path*",
    // which returns JSON rather than a rewrite. Both entries must be present.
    expect(config.matcher).toContain("/api/:path*");
  });
});
