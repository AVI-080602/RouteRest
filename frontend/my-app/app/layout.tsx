import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

// The browser tab previously read "Create Next App" (the scaffold default,
// BA item 15). `template` lets each page contribute its own name while the
// product name stays visible in every tab, e.g. "New Journey | RouteRest".
export const metadata: Metadata = {
  title: {
    default: "RouteRest",
    template: "%s | RouteRest",
  },
  description:
    "Plan heavy-vehicle journeys across Australia with NHVR-compliant rest breaks and suitable rest stop suggestions.",
  applicationName: "RouteRest",
};

// Next 16 keeps theme colour and colour scheme in `viewport`, not
// `metadata`. Light only: the app has a single white/green theme.
export const viewport: Viewport = {
  themeColor: "#15803d",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen bg-surface text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
