import { isSameOriginRequest } from "@/lib/csrf";
import * as api from "@/lib/kamui/client";
import { UpstreamError } from "@/lib/kamui/errors";
import { toPublicCustomer } from "@/lib/kamui/map";
import { fail, failFromUpstream, json, readJson } from "@/lib/http";
import { normalizePhoneInput } from "@/lib/phone";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { setCustomerSession, setPendingSession } from "@/lib/session";
import { MEMBERS_ONLY } from "@/lib/site";
import { cookies } from "next/headers";
import { TELEGRAM_GATE_ENABLED, telegramEnv } from "@/lib/telegram";
import { TELEGRAM_COOKIE, verifyTelegramToken } from "@/lib/telegram-token";

/**
 * POST /api/auth/send-code — start phone sign-in.
 *
 * THROTTLED ON PURPOSE. This route makes the backend send an SMS on our API
 * key's authority; without a limiter it is a paid-message pump. Two buckets:
 * per client and per phone number, because either alone is trivially sidestepped.
 *
 * Upstream normally answers `{ sent: true }`. When a store has OTP switched off
 * it short-circuits and returns a session token immediately — handled here so
 * that configuration does not strand the user on a code screen that will never
 * receive a code.
 */

export const dynamic = "force-dynamic";

const PER_CLIENT = { limit: 8, windowMs: 10 * 60_000 };
const PER_PHONE = { limit: 4, windowMs: 10 * 60_000 };

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginRequest(req)) return fail(403, "forbidden");

  const body = await readJson<{ phone?: unknown }>(req);
  const phone = normalizePhoneInput(body?.phone);
  if (!phone) {
    return fail(400, "invalid_phone", { message: "Enter a valid mobile number." });
  }

  /**
   * THE SMS ITSELF REQUIRES THE CHANNEL CHECK — not just access to the site.
   *
   * The proxy already refuses a signed-out visitor the shop, so a forged or
   * absent Telegram cookie could never reach the catalogue. But this route
   * SPENDS MONEY on the tenant's behalf and is reachable directly: without this
   * check, anyone outside Telegram could POST a customer's number and make the
   * shop text them. They would gain no access — the gate needs both cookies —
   * but the owner's requirement is that a code is sent "only and only if" the
   * person came through Telegram, and an SMS they did not ask for is exactly
   * the harm.
   *
   * VERIFIED, not merely present. Middleware checks this cookie for presence
   * because a forgery buys nothing there. Here it decides whether to send, so
   * the signature is checked — otherwise the whole thing is a cookie anyone can
   * type.
   */
  if (TELEGRAM_GATE_ENABLED) {
    const env = telegramEnv();
    const cookie = (await cookies()).get(TELEGRAM_COOKIE)?.value;
    const claim = env ? await verifyTelegramToken(cookie, env.jwtSecret) : null;
    if (!claim) {
      return fail(403, "not_in_channel", {
        message: "Open this store from the channel to continue.",
      });
    }
  }

  const byClient = rateLimit(clientKey(req, "send-code"), PER_CLIENT.limit, PER_CLIENT.windowMs);
  const byPhone = rateLimit(`send-code:phone:${phone}`, PER_PHONE.limit, PER_PHONE.windowMs);
  if (!byClient.ok || !byPhone.ok) {
    const retry = Math.max(byClient.retryAfterSeconds, byPhone.retryAfterSeconds);
    return json(
      { error: "rate_limited", message: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }

  try {
    // A members-only shop refuses an unknown phone UPSTREAM, before an SMS is
    // sent — this tenant should not pay for a code addressed to someone who
    // cannot use it, from a shop they cannot see.
    const res = await api.sendLoginCode(phone, { membersOnly: MEMBERS_ONLY });

    if ("token" in res) {
      // Store has OTP disabled: we already hold a token.
      if ("customer" in res) {
        await setCustomerSession(res.token);
        return json({ status: "signed_in", customer: toPublicCustomer(res.customer) });
      }
      await setPendingSession(res.token);
      return json({ status: "needs_profile" });
    }

    return json({ status: "code_sent" });
  } catch (e) {
    // The members-only refusal is a real answer, not a fault: this number is
    // not a customer of this store. It has to reach the UI as itself, or the
    // person is told "try again later" about something retrying cannot fix.
    if (e instanceof UpstreamError && e.status === 403) {
      return fail(403, "not_a_customer", {
        message: "That number isn't registered with this store.",
      });
    }
    return failFromUpstream(e, "We couldn't send a code right now. Please try again.");
  }
}
