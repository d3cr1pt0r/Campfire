// Fit complete participant cards, including their individual media controls.
export function fitCallParticipants(width: number, height: number, count: number) {
    const gap = 12;
    let columns = 1;
    let scale = 0;
    for (let candidate = 1; candidate <= count; candidate++) {
        const rows = Math.ceil(count / candidate);
        const fit = Math.max(
            0,
            Math.min(
                1,
                (width - gap * (candidate - 1)) / (290 * candidate),
                (height - gap * (rows - 1)) / (272 * rows),
            ),
        );
        if (fit > scale) {
            scale = fit;
            columns = candidate;
        }
    }
    return { scale, width: columns * 290 * scale + (columns - 1) * gap };
}
