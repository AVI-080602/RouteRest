import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata, so
// the tab title ("New Journey | RouteRest", via the root layout's title
// template) lives in this thin server layout instead.
export const metadata: Metadata = {
  title: "New Journey",
};

export default function NewJourneyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
