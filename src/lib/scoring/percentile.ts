/**
 * Percentile ranks for score v2 (KTD10): each component, and then the weighted composite, is
 * re-expressed as where a station stands among the ranked stations, 0 for the lowest value and
 * 100 for the highest.
 */

/**
 * The midrank percentile of each value among all of them, in input order: 100 * (rank - 1) / (n - 1)
 * with tied values sharing the average of their ranks, so a tie never favors one station. A lone
 * value sits at the median, 50.
 */
export function midrankPercentiles(values: readonly number[]): number[] {
    if (values.some((v) => !Number.isFinite(v))) throw new Error("Percentiles need finite numbers");
    const n = values.length;
    if (n === 0) return [];
    if (n === 1) return [50];

    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const result = new Array<number>(n);
    let start = 0;
    while (start < n) {
        let end = start;
        while (end + 1 < n && order[end + 1].value === order[start].value) end++;
        // Positions start..end are 0-based, so the tie's average 1-based rank is (start + end) / 2 + 1.
        const pct = (100 * ((start + end) / 2)) / (n - 1);
        for (let i = start; i <= end; i++) result[order[i].index] = pct;
        start = end + 1;
    }
    return result;
}
