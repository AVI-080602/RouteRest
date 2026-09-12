/**
 * One red line under a form field. Renders nothing when there is no
 * message, so callers can write `<FieldError message={errors.x} />`
 * unconditionally instead of repeating `{errors.x && <p ...>}` (that
 * pattern was pasted thirteen times in the journey form).
 *
 * `role="alert"` makes screen readers announce the message the moment it
 * appears, which the previous plain <p> did not do.
 */
export default function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="mt-1 text-sm text-danger">
      {message}
    </p>
  );
}
