import type { MetadataRoute } from "next";

/** Web app manifest, so "Add to Home Screen" opens write standalone, without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "write",
    short_name: "write",
    start_url: "/",
    display: "standalone",
    background_color: "#fcfcfb",
    theme_color: "#fcfcfb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
