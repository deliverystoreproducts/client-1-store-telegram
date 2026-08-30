/**
 * The crawler list, in ONE place, used by two things that must not disagree:
 * `src/app/robots.ts` (which asks them not to crawl) and `src/proxy.ts` (which
 * refuses them when they do it anyway).
 *
 * Pure module, no imports: read by the proxy in middleware.
 *
 * WHAT THIS CAN AND CANNOT DO — read this before believing the site is hidden.
 *
 * Nothing in an application can stop a request from ARRIVING. By the time this
 * code runs, the connection is open and the crawler already knows the domain
 * resolves and something answers on it. Stopping the request itself needs
 * something in FRONT of the app — Cloudflare or an equivalent WAF — which is a
 * hosting decision, not a code one.
 *
 * What this does is make the answer worthless and cheap: a known crawler gets
 * 403 and an empty body, before any page renders, before any upstream call.
 * Combined with the members gate — which already means an unknown visitor sees
 * a blank shell with no store name, no links and no catalogue — a crawler that
 * ignores robots.txt entirely still ends up with nothing to index.
 *
 * NO BARE "bot" SUBSTRING. It is the obvious shortcut and it blocks real
 * customers: Android UA strings contain device names like `CUBOT_X30`. Every
 * entry here is an explicit token, matched case-insensitively.
 */

/** Named crawlers — AI training and retrieval, search, SEO resellers, archivers. */
export const NAMED_CRAWLERS = [
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
  "Kangaroo Bot", "Webzio-Extended", "Scrapy", "petalbot",
  // Search engines that are not Google or Bing
  "Slurp", "DuckDuckBot", "Baiduspider", "YandexBot", "Sogou", "Exabot",
  // SEO / backlink crawlers — these resell the crawl
  "AhrefsBot", "SemrushBot", "MJ12bot", "DotBot", "BLEXBot", "DataForSeoBot",
  // Archivers
  "ia_archiver", "archive.org_bot", "Wayback",
  // Link-preview fetchers. Deliberately included: a pasted link to this shop
  // should unfurl into nothing, in Telegram as much as anywhere. This is the
  // preview bot, NOT the Mini App — the Mini App runs in a webview with an
  // ordinary browser user-agent and is unaffected.
  "TelegramBot", "Twitterbot", "Slackbot", "Discordbot", "WhatsApp",
  "LinkedInBot", "SkypeUriPreview", "redditbot", "Pinterestbot",
] as const;

/**
 * Generic tokens, kept deliberately short. Each one is a word no browser or
 * device puts in a user-agent. `curl` and `wget` are NOT here on purpose —
 * they are how this deployment gets verified, and blocking them would break
 * the ops checks without stopping a single real crawler.
 */
const GENERIC_TOKENS = ["crawler", "spider", "scraper", "crawling"] as const;

const PATTERN = new RegExp(
  [...NAMED_CRAWLERS, ...GENERIC_TOKENS]
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "i",
);

export function isCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return PATTERN.test(userAgent);
}
