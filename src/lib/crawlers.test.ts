import { describe, expect, it } from "vitest";
import { NAMED_CRAWLERS, isCrawler } from "@/lib/crawlers";

/**
 * The dangerous half of this list is the FALSE POSITIVES. A crawler that slips
 * through costs nothing — the members gate already gives it a blank shell. A
 * real customer who matches the pattern cannot shop, and would report it as
 * "the app is broken", which is indistinguishable from every other gate bug.
 *
 * The specific trap: a bare "bot" substring. Android user-agents carry device
 * names, and `CUBOT_X30` is a real phone. That single shortcut would have
 * silently locked out every customer holding one.
 */
describe("isCrawler", () => {
  it.each([
    ["GPTBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot"],
    ["ClaudeBot", "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"],
    ["CCBot", "CCBot/2.0 (https://commoncrawl.org/faq/)"],
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["PerplexityBot", "Mozilla/5.0 (compatible; PerplexityBot/1.0)"],
    ["Bytespider", "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)"],
    ["AhrefsBot", "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)"],
    ["a link preview", "TelegramBot (like TwitterBot)"],
    ["a generic crawler", "SomeNewThing/1.0 (web crawler)"],
    ["a generic spider", "unknown-spider/2"],
  ])("refuses %s", (_label, ua) => {
    expect(isCrawler(ua)).toBe(true);
  });

  it.each([
    ["an iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"],
    ["Android Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"],
    // THE ONE THAT MATTERS. A bare "bot" substring blocks this real phone.
    ["a CUBOT phone", "Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Mobile Safari/537.36"],
    ["a Robot-branded phone", "Mozilla/5.0 (Linux; Android 11; ROBOT S1) AppleWebKit/537.36 Chrome/90.0 Mobile Safari/537.36"],
    ["desktop Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"],
    ["Telegram's in-app webview", "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"],
    // Deliberately allowed — these verify the deployment.
    ["curl", "curl/8.4.0"],
    ["wget", "Wget/1.21.4"],
  ])("lets %s through", (_label, ua) => {
    expect(isCrawler(ua)).toBe(false);
  });

  it("treats a missing user-agent as not-a-crawler", () => {
    // Refusing an empty UA would catch some scrapers and also some monitors.
    // The members gate already gives either of them nothing.
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler("")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isCrawler("gptbot/1.0")).toBe(true);
    expect(isCrawler("CLAUDEBOT")).toBe(true);
  });

  it("has no duplicate entries", () => {
    expect(new Set(NAMED_CRAWLERS).size).toBe(NAMED_CRAWLERS.length);
  });
});
