import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInitData } from "@/lib/telegram";
import { signTelegramToken, verifyTelegramToken } from "@/lib/telegram-token";

/**
 * The channel check is one of the two things standing between a stranger and
 * the shop. Every failure mode here is silent — a wrong HMAC does not throw, it
 * just refuses everyone (or, if inverted, admits everyone), and neither shows up
 * until a real user tries it inside Telegram.
 *
 * So the signing is reproduced here from Telegram's spec rather than from the
 * implementation, and the tests assert the two mistakes that are easy to make:
 * leaving `hash` in the data-check string, and skipping the freshness check.
 */

const BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-one";

/** Build a valid initData string the way Telegram does. */
function makeInitData(over: Record<string, string> = {}, token = BOT_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAABBB",
    user: JSON.stringify({ id: 4242, first_name: "Test" }),
    ...over,
  };
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const qs = new URLSearchParams(fields);
  qs.set("hash", hash);
  return qs.toString();
}

describe("verifyInitData", () => {
  it("accepts a correctly signed payload and returns the user id", () => {
    const res = verifyInitData(makeInitData(), BOT_TOKEN);
    expect(res).toEqual({ ok: true, userId: 4242 });
  });

  it("rejects a payload signed with a different bot token", () => {
    // i.e. someone else's bot cannot mint entry to this channel's shop.
    const res = verifyInitData(makeInitData({}, "999:OTHER"), BOT_TOKEN);
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a single tampered byte", () => {
    const good = makeInitData();
    const tampered = good.replace("first_name%22%3A%22Test", "first_name%22%3A%22Evil");
    expect(verifyInitData(tampered, BOT_TOKEN).ok).toBe(false);
  });

  it("rejects a tampered user id even though the rest is untouched", () => {
    // The attack that matters: swap yourself for a member's id.
    const good = makeInitData();
    const swapped = good.replace("4242", "9999");
    expect(verifyInitData(swapped, BOT_TOKEN).ok).toBe(false);
  });

  it("rejects stale initData", () => {
    // Without this a captured payload works forever, and membership "now"
    // stops meaning anything.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = verifyInitData(makeInitData({ auth_date: old }), BOT_TOKEN);
    expect(res).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a missing hash, empty input and junk", () => {
    expect(verifyInitData("", BOT_TOKEN).ok).toBe(false);
    expect(verifyInitData("user=%7B%7D&auth_date=1", BOT_TOKEN).ok).toBe(false);
    expect(verifyInitData("not-a-query-string", BOT_TOKEN).ok).toBe(false);
  });

  it("rejects a hash of the wrong length without throwing", () => {
    // timingSafeEqual throws on length mismatch; the guard must catch it.
    const bad = makeInitData().replace(/hash=[0-9a-f]+/, "hash=abc");
    expect(() => verifyInitData(bad, BOT_TOKEN)).not.toThrow();
    expect(verifyInitData(bad, BOT_TOKEN).ok).toBe(false);
  });
});

describe("telegram token", () => {
  const SECRET = "test-jwt-secret";
  const future = Math.floor(Date.now() / 1000) + 3600;

  it("round-trips a claim", async () => {
    const token = await signTelegramToken({ tg: 4242, exp: future }, SECRET);
    expect(await verifyTelegramToken(token, SECRET)).toEqual({ tg: 4242, exp: future });
  });

  it("refuses a flipped signature byte", async () => {
    // This is the whole reason the cookie is signed: middleware trusts it with
    // no upstream to re-check against.
    const token = await signTelegramToken({ tg: 4242, exp: future }, SECRET);
    const dot = token.indexOf(".");
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const flipped = `${body}.${sig.slice(0, -1)}${sig.slice(-1) === "A" ? "B" : "A"}`;
    expect(await verifyTelegramToken(flipped, SECRET)).toBeNull();
  });

  it("refuses a payload edited to name a different user", async () => {
    const token = await signTelegramToken({ tg: 1, exp: future }, SECRET);
    const forged =
      Buffer.from(JSON.stringify({ tg: 9999, exp: future })).toString("base64url") +
      "." +
      token.split(".")[1];
    expect(await verifyTelegramToken(forged, SECRET)).toBeNull();
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signTelegramToken({ tg: 4242, exp: future }, "other-secret");
    expect(await verifyTelegramToken(token, SECRET)).toBeNull();
  });

  it("refuses an expired token", async () => {
    const token = await signTelegramToken({ tg: 4242, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    expect(await verifyTelegramToken(token, SECRET)).toBeNull();
  });

  it("refuses undefined, junk and a missing secret", async () => {
    expect(await verifyTelegramToken(undefined, SECRET)).toBeNull();
    expect(await verifyTelegramToken("garbage", SECRET)).toBeNull();
    expect(await verifyTelegramToken("a.b", SECRET)).toBeNull();
    const token = await signTelegramToken({ tg: 1, exp: future }, SECRET);
    expect(await verifyTelegramToken(token, "")).toBeNull();
  });
});
