"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "@/utils/appNavigation";
import { readAppHistory } from "@/components/AppHistory";

/**
 * Back to the previous page, on every page except Home.
 *
 * Goes back through the browser history when the previous page in this
 * tab was a RouteRest page (components/AppHistory.tsx keeps that list),
 * so Back undoes exactly the last step. When there is no such page (a
 * link opened straight to this page, a QR code, a new tab), going back
 * would leave the app, so it goes to `fallback` instead: the page that
 * normally comes before this one.
 */
export default function BackButton({
  fallback,
  label = "Back",
  className = "",
}: {
  /** Where to go when there is no earlier RouteRest page in this tab. */
  fallback: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (readAppHistory().length >= 2) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-alt text-ink transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft ${className}`}
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
    </button>
  );
}
