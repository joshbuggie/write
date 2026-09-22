import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "write", template: "%s · write" },
  description: "Plain-markdown notes you own.",
  applicationName: "write",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "write", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// Never set maximumScale/userScalable: pinch-zoom must keep working. viewportFit "cover" lets the phone
// layouts pad themselves with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#161615" },
  ],
};

/** Root HTML shell. No I/O here, and system fonts only, so builds work offline. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
