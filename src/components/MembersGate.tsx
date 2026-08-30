"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ClientApiError } from "@/lib/client-api";
import { formatPhone } from "@/lib/phone";

/**
 * The members-only gate: a blank white screen and a phone number.
 *
 * WHAT IS DELIBERATELY ABSENT. No store name, no logo, no mark, no navigation,
 * no theme toggle, no footer. A stranger who lands here should not learn whose
 * site it is or what is sold. The layout renders this INSTEAD of the shop
 * (never around it), so the catalogue is not in the document at all — not in
 * the markup and not in the RSC flight payload. A gate that only wins in the
 * pixels is not a control.
 *
 * TWO STEPS ONLY: number, then code. There is no registration step, and adding
 * one would be building a path that cannot be taken — the upstream refuses an
 * unknown phone before sending, so anyone who reaches the code step is already
 * a customer and `verify-code` always resolves to their record.
 *
 * NOT `SignInFlow`. That component is shared with checkout, so restyling it
 * would change the checkout sign-in too.
 *
 * The privacy link is not decoration and must not be removed to make the screen
 * emptier: this form collects a phone number, so it is a point of collection,
 * and B&P § 22575 wants the policy conspicuously posted.
 */
/**
 * The Telegram handle the vendored SDK installs. Only the two fields this gate
 * uses are typed — `initData` and `expand`. A fuller surface would invite code
 * that depends on it, and every one of those calls is a no-op outside Telegram.
 */
declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } };
  }
}

export function MembersGate({ telegramGate }: { telegramGate: boolean }) {
  const router = useRouter();
  /**
   * `checking` and `blocked` exist only when the Telegram gate is on.
   *
   * `blocked` is what makes the shop channel-only: no phone form is rendered at
   * all, so someone who opened the URL in a normal browser — or who left the
   * channel — has nothing to submit. Hiding the form is the point; a disabled
   * one would still tell them what the shop wants.
   */
  const [step, setStep] = useState<"checking" | "blocked" | "phone" | "code">(
    telegramGate ? "checking" : "phone",
  );
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, "");

  /**
   * boot() — check ①.
   *
   * `initData` lives in the URL hash, which never reaches the server, so this
   * cannot be done in middleware and the first paint is always a blank shell.
   * That is inherent to the Mini App design, not a shortcut.
   *
   * Runs once. Opened outside Telegram there is no `initData` and the visitor is
   * blocked without a request being made — no point asking the server whether a
   * payload we do not have is valid.
   */
  useEffect(() => {
    if (!telegramGate) return;
    let stop = false;

    (async () => {
      const wa = window.Telegram?.WebApp;
      // Ask Telegram for the full sheet: a Mini App opens at half height and
      // the customer would otherwise have to drag it up to reach the button.
      try {
        wa?.ready?.();
        wa?.expand?.();
      } catch {
        /* not inside Telegram — the block below is the answer */
      }

      const initData = wa?.initData ?? "";
      if (!initData) {
        if (!stop) setStep("blocked");
        return;
      }

      try {
        await apiPost("/api/auth/telegram", { initData });
        if (!stop) setStep("phone");
      } catch {
        // Every refusal is the same refusal by design — not a member, stale
        // payload, forged signature, Telegram unreachable. Distinguishing them
        // for the visitor would only help someone probing.
        if (!stop) setStep("blocked");
      }
    })();

    return () => {
      stop = true;
    };
  }, [telegramGate]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/auth/send-code", { phone });
      setStep("code");
    } catch (err) {
      // `not_a_customer` arrives as its own message and is shown as-is. Telling
      // someone to "try again later" about not being a customer would send them
      // round a loop that cannot resolve.
      setError(
        err instanceof ClientApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/auth/verify-code", { phone, code });
      // A full reload, not a client navigation: the session cookie has just been
      // set, and the gate decision is made server-side in middleware. Only a new
      // request re-runs it — a soft push would re-render the same gated tree.
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof ClientApiError ? err.message : "That code didn't work. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="mgate">
      <div className="mgate-inner">
        {error ? (
          <p className="mgate-error" role="alert">
            {error}
          </p>
        ) : null}

        {step === "checking" ? (
          <p className="mgate-note" role="status">
            Checking your access…
          </p>
        ) : step === "blocked" ? (
          <p className="mgate-note" role="status">
            This store is open to channel members only. Open it from the channel
            to continue.
          </p>
        ) : step === "phone" ? (
          <form onSubmit={sendCode}>
            <p className="mgate-note">
              Enter your mobile number and we&apos;ll text you a code.
            </p>

            <label className="mgate-label" htmlFor="mg-phone">
              Mobile number
            </label>
            <input
              id="mg-phone"
              className="mgate-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />

            <button className="mgate-btn" type="submit" disabled={busy || digits.length < 10}>
              {busy ? "Sending…" : "Send code"}
            </button>

            <p className="mgate-fine">
              We only use it to sign you in. See our{" "}
              <a href="/privacy">privacy policy</a>.
            </p>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="mgate-note">
              We sent a code to {formatPhone(phone)}. Enter it below.
            </p>

            <label className="mgate-label" htmlFor="mg-code">
              Code
            </label>
            <input
              id="mg-code"
              className="mgate-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />

            <button className="mgate-btn" type="submit" disabled={busy || code.trim().length < 4}>
              {busy ? "Checking…" : "Continue"}
            </button>

            <p className="mgate-fine">
              <button
                className="mgate-back"
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
              >
                Use a different number
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
