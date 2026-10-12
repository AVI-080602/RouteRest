import BackButton from "@/components/BackButton";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * Back on the left, dark mode on the right: the top row for pages that
 * have no header of their own (after-rest, journey rating, the rating
 * demo, fatigue monitoring). Pages with a header put the same two
 * buttons in it instead.
 */
export default function PageTopBar({
  fallback,
  className = "",
}: {
  /** Where Back goes when there is no earlier RouteRest page in this tab. */
  fallback: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <BackButton fallback={fallback} />
      <ThemeToggle />
    </div>
  );
}
