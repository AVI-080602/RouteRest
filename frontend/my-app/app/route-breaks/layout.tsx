import type { Metadata } from "next";

// Same reasoning as app/newjourney/layout.tsx: the page is a client
// component, so its tab title is declared here.
export const metadata: Metadata = {
  title: "Route & Breaks",
};

export default function RouteBreaksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
