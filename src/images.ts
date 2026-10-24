export const fitImage = (width: number, height: number, side: number) => {
    const scale = Math.min(1, side / width, side / height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};
// Image attachments show at their own aspect ratio within 480×360 without enlarging;
// extremely narrow or flat images keep a minimum side and are cropped to it.
export const attachmentFrame = (width: number, height: number, minimum = 48) => {
    const scale = Math.min(1, 480 / width, 360 / height);
    return {
        width: Math.max(Math.min(minimum, width), Math.round(width * scale)),
        height: Math.max(Math.min(minimum, height), Math.round(height * scale)),
    };
};
export async function resizeImage(file: File, side: number): Promise<string> {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB');
    const bitmap = await createImageBitmap(file);
    try {
        const size = fitImage(bitmap.width, bitmap.height, side);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image resizing is unavailable');
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        return canvas.toDataURL('image/png').split(',')[1];
    } finally {
        bitmap.close();
    }
}

export type AvatarPosition = { x: number; y: number; zoom: number };
export function avatarCrop(width: number, height: number, position: AvatarPosition) {
    if (
        ![width, height, position.x, position.y, position.zoom].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
    )
        throw new Error('Invalid image dimensions or crop');
    const minimumZoom = Math.min(width, height) / Math.max(width, height);
    const zoom = Math.max(minimumZoom, Math.min(4, position.zoom));
    const side = Math.min(width, height) / zoom;
    return {
        x: (width - side) * Math.max(0, Math.min(1, position.x)),
        y: (height - side) * Math.max(0, Math.min(1, position.y)),
        side,
    };
}

export function drawAvatar(
    canvas: HTMLCanvasElement,
    bitmap: ImageBitmap,
    position: AvatarPosition,
) {
    const crop = avatarCrop(bitmap.width, bitmap.height, position);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image positioning is unavailable');
    const scale = canvas.width / crop.side;
    context.fillStyle = '#19191b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        bitmap,
        -crop.x * scale,
        -crop.y * scale,
        bitmap.width * scale,
        bitmap.height * scale,
    );
}
