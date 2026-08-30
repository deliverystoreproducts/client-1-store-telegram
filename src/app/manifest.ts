import type { MetadataRoute } from "next";
import { SITE_TAGLINE } from "@/lib/site";

// The install identity: what the launcher shows once someone adds the store to
// a home screen. start_url is "/" on purpose — a fresh launch still walks
// through the age gate like any other visit; installing buys no bypass.
//
// MEMBERS-ONLY SHOPS GET A BLANK ONE. A `<link rel="manifest">` is injected by
// file convention on every page, gate included, and the browser fetches it
// WITHOUT cookies — a no-cors request that carries no session, so it cannot be
// answered per-visitor the way the page can. Anyone who opened the URL could
// read the store's name, its tagline and its icon set out of the manifest while
// the page above it said "Under construction".
//
// So the identity is dropped for the whole deployment when MEMBERS_ONLY is on.
// The cost is a home-screen install that shows no branding — irrelevant here,
// because the shop is entered from a Telegram Mini App and nobody installs it.
export default function manifest(): MetadataRoute.Manifest {
  if ((process.env.MEMBERS_ONLY || "").trim().toLowerCase() === "on") {
    return {
      id: "/",
      name: "Under construction",
      short_name: "Under construction",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [],
    };
  }

  const name = process.env.NEXT_PUBLIC_SITE_NAME || "YB Cannabis Co.";
  return {
    id: "/",
    name,
    short_name: process.env.NEXT_PUBLIC_SITE_SHORT_NAME || "YB",
    description: SITE_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#f6fbf2",
    theme_color: "#f6fbf2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
