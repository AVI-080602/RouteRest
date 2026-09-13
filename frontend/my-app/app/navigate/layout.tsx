import type { Metadata } from "next";

// The navigation page is a client component and cannot export metadata,
// so its tab title lives here (same pattern as the other pages).
export const metadata: Metadata = {
  title: "Navigation",
};

export default function NavigateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
