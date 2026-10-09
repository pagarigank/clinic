/**
 * `fuzzyFilter` — local fuzzy (subsequence) ranking for small, already-loaded
 * reference lists, used by `SearchCombobox` on screening/ordering forms where a
 * plain `<select>` is unusable at real catalogue sizes.
 *
 * It is deliberately pure and client-side: the caller loads a bounded list
 * (tests, supply items) once and filters it as the user types. Pickers that
 * must page a large server-side catalogue still drive `SearchCombobox.onSearch`
 * instead — this helper is not a substitute for server-side search.
 *
 * Ranking keeps the likely choice at the top of a short list:
 *  - a substring hit scores above any subsequence hit, and an earlier match
 *    position scores above a later one (so a prefix wins);
 *  - otherwise every query character must appear in order, penalised by the
 *    number of skipped characters.
 *
 * Ties preserve the input order (Array.prototype.sort is stable).
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  toText: (item: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const haystack = toText(item).toLowerCase();
    const at = haystack.indexOf(q);
    if (at >= 0) {
      scored.push({ item, score: 1000 - at });
      continue;
    }

    let qi = 0;
    let skipped = 0;
    for (let i = 0; i < haystack.length && qi < q.length; i++) {
      if (haystack[i] === q[qi]) {
        qi++;
      } else if (qi > 0) {
        skipped++;
      }
    }
    if (qi === q.length) scored.push({ item, score: 100 - skipped });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
