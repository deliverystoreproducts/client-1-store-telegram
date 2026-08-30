import type { MetadataRoute } from "next";

/**
 * NOTHING MAY INDEX THIS SITE. Not a search engine, not an AI crawler, not an
 * archiver, not a preview bot. There is no `SEO_INDEX` escape hatch here and
 * there should not be one.
 *
 * The reasoning is not privacy-by-preference, it is that indexing this
 * deployment is incoherent. The only way in is the Telegram Mini App: a browser
 * visitor is refused before a route is chosen and served a blank
 * "Under construction" page with no name, no links and no catalogue. So every
 * page a crawler could reach is that same empty shell. Indexing it would put a
 * dead entry under the store's name in a search engine and give an AI model a
 * page that says nothing — while advertising to anyone looking that the domain
 * exists and belongs to a licensed cannabis retailer.
 *
 * WHY THE NAMED LIST, when `User-agent: *` already disallows everything.
 * Because compliance with the wildcard is a convention, and several AI crawlers
 * have shipped honouring only their own token. Naming them removes the
 * argument. The list will go stale — new crawlers appear constantly — which is
 * exactly why the wildcard rule above it is the real control and the
 * `X-Robots-Tag` header in next.config.ts is the one that binds even for a
 * crawler that never fetches this file.
 *
 * Three layers, deliberately:
 *   1. this file          — asks politely, by wildcard and by name
 *   2. X-Robots-Tag       — tells indexers that DO fetch the page not to keep it
 *   3. the members gate   — makes the point moot: there is nothing to index
 *
 * `force-dynamic` because Next otherwise PRERENDERS this route and bakes in the
 * build environment's answer. That already caused one bug in this file's
 * history; see the same warning in src/app/manifest.ts.
 */
export const dynamic = "force-dynamic";

/**
 * AI training / retrieval crawlers, and the SEO crawlers that feed them.
 * Sorted by operator so additions land in an obvious place.
 */
const NAMED_CRAWLERS = [
  // OpenAI
  "GPTBot", "ChatGPT-User", "OAI-SearchBot",
  // Anthropic
  "ClaudeBot", "Claude-Web", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  // Google — Google-Extended is the AI-training opt-out token, separate from Googlebot
  "Google-Extended", "GoogleOther", "Googlebot", "Googlebot-Image",
  // Microsoft / Bing
  "bingbot", "msnbot",
  // Common Crawl — the corpus most models are trained from
  "CCBot",
  // Perplexity
  "PerplexityBot", "Perplexity-User",
  // ByteDance
  "Bytespider",
  // Amazon
  "Amazonbot",
  // Apple — Applebot-Extended is the AI-training token
  "Applebot", "Applebot-Extended",
  // Meta
  "FacebookBot", "meta-externalagent", "meta-externalfetcher",
  // Others that publish a token
  "cohere-ai", "cohere-training-data-crawler", "Diffbot", "ImagesiftBot",
  "Omgilibot", "Omgili", "YouBot", "Timpibot", "AI2Bot", "PanguBot",
  "Kangaroo Bot", "Webzio-Extended", "Scrapy", "petalbot", "Applebot-Extended",
  // Search engines that are not Google or Bing
  "Slurp", "DuckDuckBot", "Baiduspider", "YandexBot", "Sogou", "Exabot",
  // SEO / backlink crawlers — these resell the crawl
  "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "BLEXBot", "DataForSeoBot",
  // Archivers
  "ia_archiver", "archive.org_bot", "Wayback",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // The real control. Everything, everywhere, refused.
      { userAgent: "*", disallow: "/" },
      // And again by name, for the crawlers that read only their own section.
      ...NAMED_CRAWLERS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    // No sitemap, deliberately — there is nothing to offer and a sitemap is an
    // invitation.
  };
}
