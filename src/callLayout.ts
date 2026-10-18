// Fill the stage, choosing the grid with the most room for uncropped 16:9 video.
export function fitCallParticipants(width: number, height: number, count: number) {
    if (width <= 0 || height <= 0 || count <= 0)
        return { columns: 1, rows: 0, width: 0, height: 0 };
    const gap = 12;
    let columns = 1;
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
        }
    }
    return { columns, rows: Math.ceil(count / columns), width, height };
}
