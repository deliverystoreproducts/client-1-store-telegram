import type { NextConfig } from "next";

/**
 * The storefront runs as a self-contained Node server (`output: "standalone"`),
 * so it can be dropped into any container host. Everything that talks to the
 * upstream commerce API happens inside that server process — see README.md.
 */
const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // The barcode reader's WASM binary is read off disk at runtime (see
  // src/lib/identity/decode.ts), so nothing in the module graph references it
  // as an import and the standalone tracer would leave it behind. Without this
  // the ID check still works — it degrades to "a human should look" — but it
  // degrades everywhere, silently, which is the worst way to lose a feature.
  //
  // EVERY route that decodes must be listed. `/api/checkout` was added when the
  // ID check moved from once-at-signup to once-per-order and this list was not
  // updated with it — so on a standalone build the per-order check, which is
  // the one that actually gates a sale, would have been the one running without
  // its decoder. Silently, and only in production, because dev reads the file
  // straight out of node_modules.
  //
  // Adding a decode site? Add it here. There is no test that will tell you.
  outputFileTracingIncludes: {
    "/api/auth/register": [
      "./node_modules/.pnpm/zxing-wasm@*/node_modules/zxing-wasm/dist/reader/*.wasm",
    ],
    "/api/checkout": [
      "./node_modules/.pnpm/zxing-wasm@*/node_modules/zxing-wasm/dist/reader/*.wasm",
    ],
  },

  // Do NOT ship the `x-powered-by` header — it says nothing useful and is one
  // more fingerprint on every response.
  poweredByHeader: false,

  // Client source maps are OFF on purpose. A production source map ships the
  // pre-bundling module graph to the browser: file paths, comments, dead
  // branches. This app's whole threat model is "the browser learns nothing
  // about the backend", and a source map is the cheapest way to break that.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // NOTHING MAY INDEX THIS SITE — the layer that binds.
            //
            // robots.txt is a request; this is an instruction to an indexer that
            // already has the page, and Google, Bing and the major AI crawlers
            // honour it. It is set on EVERY response, including the ones the
            // gate short-circuits, so a crawler that reaches any URL on this
            // origin is told the same thing whatever it fetched.
            //
            // Why unconditional rather than behind SEO_INDEX: the only way into
            // this deployment is the Telegram Mini App. A browser visitor is
            // refused before a route is chosen, so every page a crawler can
            // reach is the same blank shell. Indexing it would file a dead
            // entry under the store's name and advertise that this domain
            // belongs to a licensed cannabis retailer — cost with no benefit.
            //
            // noarchive/nosnippet/noimageindex stop the cached copy, the
            // excerpt and the thumbnail. noai/noimageai are not a standard;
            // they are honoured by some crawlers and cost nothing to state.
            key: "X-Robots-Tag",
            value:
              "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai",
          },
          // X-Frame-Options is REMOVED, deliberately. It has no allow-list
          // syntax — DENY or SAMEORIGIN and nothing else — so it cannot express
          // "Telegram may frame this, nobody else may". CSP frame-ancestors
          // below can, and supersedes it wherever both are understood. Leaving
          // DENY here would simply win, and the Mini App would show a blank
          // panel in Telegram Web and Desktop, which iframe it. iOS/Android use
          // a native webview and would have worked — the split failure that
          // gets reported as "broken for some people".
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            // "The browser never talks to anyone but this origin" is the
            // site's core architectural invariant — this header makes the
            // BROWSER enforce it: no script, style, font, image, fetch,
            // worker or form target may leave 'self'. 'unsafe-inline' is the
            // one concession, for Next's own hydration scripts and the
            // pre-paint theme script; even with it, no REMOTE script can
            // load. (Nonce plumbing would close that too — tracked as future
            // hardening, it needs per-request header rewriting in proxy.ts.)
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // blob: is what URL.createObjectURL() mints, and it is how the ID
              // scanner shows you the photo you just took. Without it the
              // capture silently renders nothing — the policy blocks the
              // preview while the file itself is perfectly fine. Still no
              // remote origin: a blob URL is same-origin, in-memory, and dies
              // with the page.
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "manifest-src 'self'",
              "worker-src 'self'",
              // Telegram Web and Desktop load a Mini App in an iframe. This is
              // the narrowest policy that lets them: two exact origins, no
              // wildcard, everyone else still refused. Without the Telegram
              // gate deployed this changes nothing — no other origin gains
              // anything, and the storefront is not framed by anyone else.
              "frame-ancestors 'self' https://web.telegram.org https://telegram.org",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;
