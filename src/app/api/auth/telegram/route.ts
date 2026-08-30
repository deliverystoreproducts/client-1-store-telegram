import { cookies } from "next/headers";
import { isSameOriginRequest } from "@/lib/csrf";
import { fail, json, readJson } from "@/lib/http";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { TELEGRAM_GATE_ENABLED, isChannelMember, telegramEnv, verifyInitData } from "@/lib/telegram";
import { TELEGRAM_COOKIE, TELEGRAM_MAX_AGE, signTelegramToken } from "@/lib/telegram-token";

/**
 * POST /api/auth/telegram — check ①: is this person in our channel?
 *
 * Called by boot() in the gate with `Telegram.WebApp.initData`. On success it
 * sets the membership cookie; the visitor then still has to pass check ② (phone
 * + SMS, and their number must already be a customer of this tenant). Neither
 * check substitutes for the other: channel membership is not a purchase
 * history, and a customer is not necessarily in the channel.
 *
 * WHY THIS IS A POST AND NOT A GET. `initData` arrives in the URL hash, which
 * the browser never sends to a server — so it has to be read client-side and
 * posted. That is not a workaround; it is why the Mini App spec has a boot step
 * at all, and why the first paint is always a blank shell.
 *
 * FAILS CLOSED, EVERYWHERE. Gate off, env missing, bad signature, stale payload,
 * not a member, Telegram unreachable — all 403, no cookie. "We could not check"
 * and "not a member" deliberately give the same answer, because the alternative
 * is a channel gate that opens whenever Telegram has a bad day.
 */

export const dynamic = "force-dynamic";

// initData is cheap to generate but getChatMember is a call to Telegram on our
// bot's quota. Throttle per client so a loop cannot burn it.
const PER_CLIENT = { limit: 20, windowMs: 10 * 60_000 };

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginRequest(req)) return fail(403, "forbidden");

  if (!TELEGRAM_GATE_ENABLED) {
    // Not a members-by-Telegram storefront. Say so plainly rather than
    // pretending to check — a caller that gets a vague refusal will retry.
    return fail(404, "not_enabled");
  }

  const env = telegramEnv();
  if (!env) {
    // A half-configured gate is the dangerous state. Refuse rather than guess.
    console.error("[telegram] BOT_TOKEN / CHANNEL_ID / JWT_SECRET incomplete — refusing all");
    return fail(403, "not_configured", { message: "Sign-in is unavailable right now." });
  }

  const limit = rateLimit(clientKey(req, "tg-auth"), PER_CLIENT.limit, PER_CLIENT.windowMs);
  if (!limit.ok) {
    return json(
      { error: "rate_limited", message: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await readJson<{ initData?: unknown }>(req);
  const initData = typeof body?.initData === "string" ? body.initData : "";

  const checked = verifyInitData(initData, env.botToken);
  if (!checked.ok) {
    // The reason is logged, never returned. "Which part of my forgery was
    // wrong" is not information this endpoint owes anyone.
    console.warn(`[telegram] initData rejected: ${checked.reason}`);
    return fail(403, "not_in_channel", {
      message: "Open this store from the channel to continue.",
    });
  }

  if (!(await isChannelMember(checked.userId, env))) {
    return fail(403, "not_in_channel", {
      message: "Open this store from the channel to continue.",
    });
  }

  const token = await signTelegramToken(
    { tg: checked.userId, exp: Math.floor(Date.now() / 1000) + TELEGRAM_MAX_AGE },
    env.jwtSecret,
  );

  (await cookies()).set(TELEGRAM_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: TELEGRAM_MAX_AGE,
    // No `domain` — required for the __Host- prefix to be accepted.
  });

  return json({ status: "in_channel" });
}
