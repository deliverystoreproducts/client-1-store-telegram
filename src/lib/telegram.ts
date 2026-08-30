import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Mini App auth — the CHANNEL half of the two checks.
 *
 * ① is this person in our channel?   ← this file
 * ② is their phone a customer here?  ← the existing SMS gate, unchanged
 *
 * `server-only`: BOT_TOKEN is the HMAC key for every signature Telegram sends.
 * If it ever reached a browser, anyone could mint initData for any user id and
 * the channel check would be decorative. The import makes that a BUILD failure
 * rather than a review question.
 *
 * The browser never talks to Telegram's API here — `getChatMember` is a
 * server→server fetch. The storefront's zero-third-party-browser-requests rule
 * is intact, and that is also why the SDK is vendored into public/ rather than
 * linked.
 */

/** initData older than this is refused. It is a login proof, not a bearer token. */
const MAX_AGE_SECONDS = 15 * 60;

/** Statuses that count as being in the channel. */
const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);

export interface TelegramEnv {
  botToken: string;
  /**
   * One or more chat ids. Membership in ANY of them admits.
   *
   * CHANNEL_ID accepts a comma-separated list, so one deployment can serve
   * several closed chats — a second channel, a VIP group, a wholesale group —
   * without a second deployment or a second bot. A single id is still a single
   * id, so nothing that worked before changes.
   */
  channelIds: string[];
  jwtSecret: string;
}

/**
 * All three or nothing. A half-configured gate is the dangerous state: it would
 * either refuse everyone or, worse, be tempted into letting everyone through.
 */
export function telegramEnv(): TelegramEnv | null {
  const botToken = (process.env.BOT_TOKEN || "").trim();
  const jwtSecret = (process.env.JWT_SECRET || "").trim();
  const channelIds = (process.env.CHANNEL_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!botToken || channelIds.length === 0 || !jwtSecret) return null;
  return { botToken, channelIds, jwtSecret };
}

export const TELEGRAM_GATE_ENABLED = (process.env.TELEGRAM_GATE || "").trim().toLowerCase() === "on";

export type InitDataResult =
  | { ok: true; userId: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "stale" };

/**
 * Verify `initData` exactly as Telegram specifies.
 *
 *   secret        = HMAC_SHA256(key: "WebAppData", message: BOT_TOKEN)
 *   dataCheck     = every "k=v" except `hash`, sorted, joined by "\n"
 *   expected hash = HMAC_SHA256(key: secret, message: dataCheck)
 *
 * The two subtleties that break naive implementations:
 *
 *   - `hash` must be REMOVED before building the string, not merely ignored
 *     when comparing. Leaving it in produces a different digest every time and
 *     the check fails for everyone.
 *   - the comparison must be constant-time. A byte-wise early return leaks the
 *     correct prefix, and the attacker controls how many attempts they make.
 *
 * `auth_date` is checked too: without it a captured initData works forever, and
 * the whole point of the channel check is that it reflects membership NOW.
 */
export function verifyInitData(initData: string, botToken: string): InitDataResult {
  if (!initData) return { ok: false, reason: "malformed" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "malformed" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself an answer —
  // guard it so a wrong-length hash takes the same path as a wrong one.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "malformed" };
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  let userId: number | undefined;
  try {
    userId = JSON.parse(params.get("user") || "{}")?.id;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof userId !== "number") return { ok: false, reason: "malformed" };

  return { ok: true, userId };
}

/**
 * Is this user in the channel?
 *
 * Fails CLOSED on every uncertainty — a network error, a non-200, a shape we do
 * not recognise. "We could not check" and "they are not a member" get the same
 * answer, because the alternative is a gate that opens when Telegram is having
 * a bad day.
 *
 * Requires the bot to be an ADMIN of the channel; Telegram answers 400
 * otherwise, which lands in the same closed branch.
 */
/** One getChatMember call. False for every failure — see isChannelMember. */
async function isMemberOf(userId: number, botToken: string, chatId: string): Promise<boolean> {
  const url =
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChatMember` +
    `?chat_id=${encodeURIComponent(chatId)}&user_id=${userId}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) {
      // The overwhelmingly common cause is the bot not being an ADMINISTRATOR
      // of this chat, which Telegram answers with 400. It is indistinguishable
      // here from a wrong id, so log the status and the chat: without this the
      // symptom is "every real member is refused" with nothing in the logs,
      // which is exactly how it presented the first time.
      console.warn(`[telegram] getChatMember ${chatId} -> HTTP ${res.status}`);
      return false;
    }
    const body = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    if (!body?.ok) {
      console.warn(`[telegram] getChatMember ${chatId} -> not ok`);
      return false;
    }
    return MEMBER_STATUSES.has(body.result?.status ?? "");
  } catch (e) {
    console.warn(`[telegram] getChatMember ${chatId} failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Is this user in ANY of the configured chats?
 *
 * Checked in PARALLEL rather than in sequence: each call carries an 8s timeout,
 * and five chats checked one after another would make a slow Telegram into a
 * 40-second blank screen for a legitimate member. In parallel the worst case
 * stays one timeout however many chats are configured.
 *
 * Fails closed per chat and overall — a chat that errors simply does not admit,
 * and if none admit the answer is no.
 */
export async function isChannelMember(
  userId: number,
  { botToken, channelIds }: TelegramEnv,
): Promise<boolean> {
  const results = await Promise.all(
    channelIds.map((chatId) => isMemberOf(userId, botToken, chatId)),
  );
  return results.some(Boolean);
}
