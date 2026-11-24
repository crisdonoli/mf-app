/** Shared formatting and corpus bound helpers for MiningFOMC V3. */

export const CORPUS_MIN_DATE = "1976-01-01";
export const CORPUS_MAX_DATE = "2020-12-31";
export const CORPUS_MIN_YEAR = 1976;
export const CORPUS_MAX_YEAR = 2020;

/** Clamp an ISO date string (YYYY-MM-DD) so it never exceeds 2020-12-31. */
export function clampCorpusDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed > CORPUS_MAX_DATE) return CORPUS_MAX_DATE;
  if (trimmed < CORPUS_MIN_DATE && trimmed.length === 10) return CORPUS_MIN_DATE;
  return trimmed;
}

/**
 * Format a numeric value to 3 significant figures (e.g., 0.452, 0.0318, 1.24e-3).
 */
export function formatSigFigs(val: number | null | undefined, sigFigs = 3): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return "—";
  }
  if (val === 0) {
    return "0";
  }
  const abs = Math.abs(val);
  if (abs < 0.01 || abs >= 10000) {
    return val.toExponential(sigFigs - 1);
  }
  return val.toPrecision(sigFigs);
}
