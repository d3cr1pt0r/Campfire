export const fitImage = (width: number, height: number, side: number) => {
    const scale = Math.min(1, side / width, side / height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
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
