import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, THEME_COLORS } from "@/lib/site";

/** Lets the site be installed as an app; it works offline-free of any server anyway. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    categories: ["education", "productivity", "utilities"],
    icons: [{ src: "/icon.png", sizes: "227x227", type: "image/png", purpose: "any" }],
  };
}
