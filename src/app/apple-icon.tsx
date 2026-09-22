import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon: a rounded lowercase "w" on the light canvas. Drawn as a stroked path (the same
 * shape as icon.svg) so it needs no font file and renders identically offline. iOS rounds the corners.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fcfcfb",
      }}
    >
      <svg width="132" height="132" viewBox="0 0 64 64">
        <path
          d="M13.5 21.5 21.75 43 32 25.5 42.25 43 50.5 21.5"
          fill="none"
          stroke="#1d1d1b"
          strokeWidth={5.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    size,
  );
}
