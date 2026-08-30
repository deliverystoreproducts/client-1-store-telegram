import type { Metadata } from "next";
import { SignInPanel } from "@/components/SignInPanel";
import { headers } from "next/headers";
import { MEMBERS_GATE_HEADER } from "@/lib/members-routes";
import { getStoreProfile } from "@/lib/store";

/**
 * A PAGE metadata export overrides the root layout's, and the members gate
 * rewrites every URL to this route — so a static `title: "Sign in"` here was
 * the tab a stranger saw on a page whose whole job is to look like nothing.
 * It survived the pass that emptied the rest of the head, because the leak was
 * one directory away from the component doing the hiding.
 *
 * Gated: the layout's title stands ("Under construction"). Signed in: this is
 * the ordinary sign-in page of an open storefront and reads as one.
 */
export async function generateMetadata(): Promise<Metadata> {
  if ((await headers()).get(MEMBERS_GATE_HEADER) === "1") return {};
  return { title: "Sign in" };
}
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  /**
   * RENDER NOTHING when the members gate rewrote a URL here.
   *
   * The layout drops `children` and renders <MembersGate/> in their place, but
   * dropping them does not stop this segment being RENDERED — the App Router
   * still runs it and serialises the result into the RSC flight payload inlined
   * in the HTML. That is the same mechanism the age gate was moved into
   * middleware to defeat (src/proxy.ts: 24 products in view-source, 62 KB vs
   * 11 KB), and it applied here in miniature: the gate screen was verified
   * empty while `{"className":"eyebrow","children":"Sign in"}` and the rest of
   * this page's tree sat in a <script> below it.
   *
   * The age gate does not have this problem because it rewrites to /age, which
   * is an empty shell. The members gate rewrites to /signin, which is a real
   * page — so the emptiness has to be produced here.
   *
   * It also stops an upstream getStoreProfile() call on every request from
   * every crawler and scanner that finds the domain.
   */
  if ((await headers()).get(MEMBERS_GATE_HEADER) === "1") return null;

  const profile = await getStoreProfile();
  return (
    <div style={{ maxWidth: "58rem" }}>
      <div className="section-head" data-reveal style={{ "--i": 0 } as React.CSSProperties}>
        <span className="eyebrow">Sign in</span>
        <hr />
      </div>

      <h1
        className="display"
        data-reveal
        style={{ "--i": 1, fontSize: "var(--t-3)", maxWidth: "14ch" } as React.CSSProperties}
      >
        No password. Just your number.
      </h1>

      <p
        className="lede mt-2 mb-3"
        data-reveal
        style={{ "--i": 2 } as React.CSSProperties}
      >
        We text you a code to confirm your mobile — the same number the driver uses to reach you at
        the door.
      </p>

      <div data-reveal style={{ "--i": 3 } as React.CSSProperties}>
        <SignInPanel requireIdPhoto={profile.requireIdVerification} />
      </div>
    </div>
  );
}
