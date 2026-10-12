import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import AppHistory from "@/components/AppHistory";
import { APPLY_SAVED_THEME_SCRIPT } from "@/utils/theme";

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
// `metadata`. The brand blue colours the phone's address bar; both
// schemes are offered because the driver can switch to dark mode.
export const viewport: Viewport = {
  themeColor: "#245ac6",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the script below may set data-theme on
    // <html> before React starts, which React would otherwise report.
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        {/* Applies the driver's saved dark mode before the first paint
            (utils/theme.ts), so a page never flashes white first. */}
        <script
          dangerouslySetInnerHTML={{ __html: APPLY_SAVED_THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-screen bg-surface text-ink antialiased">
        <AppHistory />
        {children}
      </body>
    </html>
  );
}
