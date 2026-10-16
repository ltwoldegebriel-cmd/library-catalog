/** Friendly text for errors that commonly reach the user. */
export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; inner?: { name?: string }; message?: string } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.inner?.name === 'QuotaExceededError' || /QuotaExceeded/i.test(e.message ?? ''));
}
export const QUOTA_TEXT = 'Your device is out of storage for this site. Free up space or export a backup first. Nothing was changed.';
export const errorText = (err: unknown) => (isQuotaError(err) ? QUOTA_TEXT : (err as Error)?.message ?? String(err));
