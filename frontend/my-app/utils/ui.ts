/**
 * Shared Tailwind class strings for the handful of controls the app
 * repeats everywhere (inputs, selects, labels, the primary button).
 *
 * Before this file existed the same 13-class input string was pasted
 * seven times across the journey form with three slightly different
 * padding variants, and the primary button string had drifted into four
 * near-identical copies. Constants (rather than a Button/Input component
 * library) are deliberate: three pages and one form do not justify a
 * component layer, but one place to change a colour or a radius does.
 *
 * Colour names (surface, ink, muted, brand, danger, line) are the tokens
 * declared in app/globals.css.
 */

/** Text, date, time and number inputs. Uniform `px-3` on purpose: an
 * earlier `pr-1` override jammed the native date/time picker icon against
 * the border (BA item 13). */
export const INPUT_CLASS =
  "h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft/40";

/** Native <select>, with room on the right for the chevron icon that is
 * drawn on top of it. */
export const SELECT_CLASS = `${INPUT_CLASS} appearance-none pr-10`;

/** Read-only "field" that displays a computed value (jurisdiction,
 * driving hours) in the same shape as a real input so the form reads as
 * one grid. */
export const READONLY_FIELD_CLASS =
  "flex h-12 w-full items-center rounded-xl border border-line bg-surface-alt px-3 text-base text-ink";

export const LABEL_CLASS = "text-sm font-semibold text-muted";

export const HELPER_CLASS = "text-xs text-muted";

/** The single primary call to action on each page. */
export const PRIMARY_BUTTON_CLASS =
  "inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white transition hover:bg-brand-strong active:bg-brand-strong disabled:opacity-60 disabled:hover:bg-brand";

/** Full-size outlined button, the same height and shape as the primary
 * one, for a second real choice that sits directly under it (for example
 * "Scan a journey" under "Plan my journey"). An underlined text link was
 * used there before, and drivers did not read it as something to tap. */
export const OUTLINE_BUTTON_CLASS =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-brand bg-surface px-4 font-semibold text-brand transition hover:bg-brand-tint active:bg-brand-tint";

/** Outlined secondary action, e.g. "View alternatives". */
export const SECONDARY_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand-tint";

/** Low-emphasis action, e.g. "Use original suggestion". */
export const GHOST_BUTTON_CLASS =
  "inline-flex items-center justify-center rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-surface-alt";

/** A grey panel that groups related fields or summary tiles. */
export const PANEL_CLASS = "rounded-xl bg-surface-alt px-3 py-3";
