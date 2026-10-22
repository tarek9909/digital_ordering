// Ticket number allocation (TRD §9.2, TR-ALG-02 – TR-ALG-06). The I/O (row lock, open-number read)
// lives in the ticket service; this is the pure selection step.
/** Picks the next free number after `last`, wrapping within the range and skipping blocked and open numbers. */
export function pickNextNumber(last, rules, openNumbers) {
    const { rangeStart, rangeEnd } = rules;
    const skip = new Set(rules.skipNumbers);
    const size = rangeEnd - rangeStart + 1;
    let candidate = last;
    for (let i = 0; i < size; i++) {
        candidate += 1;
        if (candidate > rangeEnd || candidate < rangeStart)
            candidate = rangeStart;
        if (skip.has(candidate) || openNumbers.has(candidate))
            continue;
        return candidate;
    }
    return null; // NUMBERS_EXHAUSTED
}
/** display_number = prefix + number, no leading zeros (TR-ALG-04). */
export const displayNumber = (prefix, n) => `${prefix ?? ''}${n}`;
/** Sequence key: the counter when prefixes are used, else '' (§9.2). */
export const sequenceKey = (prefixesEnabled, counterId) => prefixesEnabled && counterId ? counterId : '';
/** Per-language skip suggestion offered in the admin UI (TR-ALG-05). */
export const SKIP_SUGGESTIONS = {
    en: [13, 14, 15, 16, 17, 18, 19],
};
