// Fit equal 16:9 tiles inside the stage, keeping incomplete rows centered.
export function fitCallParticipants(width: number, height: number, count: number) {
    if (width <= 0 || height <= 0 || count <= 0)
        return { columns: 1, rows: 0, width: 0, height: 0 };
    const gap = 12;
    let columns = 1;
    let fittedTileWidth = 0;
    let bestArea = -1;
    for (let candidate = 1; candidate <= count; candidate++) {
        const rows = Math.ceil(count / candidate);
        const tileWidth = Math.max(0, (width - gap * (candidate - 1)) / candidate);
        const tileHeight = Math.max(0, (height - gap * (rows - 1)) / rows);
        const videoWidth = Math.min(tileWidth, (tileHeight * 16) / 9);
        const area = (videoWidth * videoWidth * 9) / 16;
        if (area > bestArea) {
            bestArea = area;
            columns = candidate;
            fittedTileWidth = videoWidth;
        }
    }
    const rows = Math.ceil(count / columns);
    return {
        columns,
        rows,
        width: fittedTileWidth * columns + gap * (columns - 1),
        height: ((fittedTileWidth * 9) / 16) * rows + gap * (rows - 1),
    };
}
