import type { Metadata } from "next";

// The share page is a client component (camera and canvas work), so its
// tab title lives here, the same pattern as the other pages.
export const metadata: Metadata = {
  title: "Share Journey",
};

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
