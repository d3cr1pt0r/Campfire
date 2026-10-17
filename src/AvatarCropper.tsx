import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { avatarCrop, drawAvatar, type AvatarPosition } from './images';
import { useDialog } from './useDialog';

export function AvatarCropper({
    file,
    onSave,
    onClose,
}: {
    file: File;
    onSave: (data: string) => Promise<void>;
    onClose: () => void;
}) {
    const container = useRef<HTMLElement>(null),
        canvas = useRef<HTMLCanvasElement>(null);
    const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
    const [position, setPosition] = useState<AvatarPosition>({ x: 0.5, y: 0.5, zoom: 1 });
    const [error, setError] = useState(''),
        [saving, setSaving] = useState(false);
    const drag = useRef<{ x: number; y: number; position: AvatarPosition } | null>(null);
    useDialog(container, () => {
        if (!saving) onClose();
    });
    useEffect(() => {
        let active = true,
            owned: ImageBitmap | undefined;
        if (file.size > 10 * 1024 * 1024) {
            setError('Choose an image smaller than 10 MB');
            return;
        }
        void createImageBitmap(file)
            .then((image) => {
                if (!active) {
                    image.close();
                    return;
                }
                owned = image;
                setBitmap(image);
            })
            .catch(() => {
                if (active)
                    setError('This image could not be opened. Choose a PNG, JPEG, WebP or GIF.');
            });
        return () => {
            active = false;
            owned?.close();
        };
    }, [file]);
    useEffect(() => {
        if (canvas.current && bitmap) drawAvatar(canvas.current, bitmap, position);
    }, [bitmap, position]);
    const save = async () => {
        if (!bitmap || !canvas.current || saving) return;
        setSaving(true);
        setError('');
        try {
            await onSave(canvas.current.toDataURL('image/png').split(',')[1]);
            onClose();
        } catch (reason) {
            setError((reason as Error).message);
        } finally {
            setSaving(false);
        }
    };
    return createPortal(
        <div className="avatar-crop-backdrop">
            <section
                ref={container}
                tabIndex={-1}
                className="modal avatar-cropper"
                role="dialog"
                aria-modal="true"
                aria-label="Position profile picture"
            >
                <h2>Position your profile picture</h2>
                <p>
                    Drag the picture or use the sliders. The rounded preview shows how your avatar
                    will look.
                </p>
                <canvas
                    ref={canvas}
                    width={512}
                    height={512}
                    className="avatar-crop-preview"
                    aria-label="Profile picture preview"
                    onPointerDown={(event) => {
                        if (!bitmap || saving) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        drag.current = { x: event.clientX, y: event.clientY, position };
                    }}
                    onPointerMove={(event) => {
                        if (!drag.current || !bitmap || saving) return;
                        const start = drag.current,
                            crop = avatarCrop(bitmap.width, bitmap.height, start.position);
                        const scale = crop.side / event.currentTarget.getBoundingClientRect().width;
                        const adjust = (dimension: number, original: number, delta: number) =>
                            Math.abs(dimension - crop.side) < 0.001
                                ? original
                                : Math.max(
                                      0,
                                      Math.min(
                                          1,
                                          original - (delta * scale) / (dimension - crop.side),
                                      ),
                                  );
                        setPosition({
                            ...start.position,
                            x: adjust(bitmap.width, start.position.x, event.clientX - start.x),
                            y: adjust(bitmap.height, start.position.y, event.clientY - start.y),
                        });
                    }}
                    onPointerUp={() => {
                        drag.current = null;
                    }}
                    onPointerCancel={() => {
                        drag.current = null;
                    }}
                    onLostPointerCapture={() => {
                        drag.current = null;
                    }}
                />
                <label>
                    Zoom
                    <input
                        type="range"
                        min={
                            bitmap
                                ? Math.min(bitmap.width, bitmap.height) /
                                  Math.max(bitmap.width, bitmap.height)
                                : 1
                        }
                        max={4}
                        step="0.01"
                        value={position.zoom}
                        disabled={!bitmap || saving}
                        onChange={(event) =>
                            setPosition({ ...position, zoom: Number(event.target.value) })
                        }
                    />
                </label>
                <label>
                    Horizontal position
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={position.x}
                        disabled={!bitmap || saving}
                        onChange={(event) =>
                            setPosition({ ...position, x: Number(event.target.value) })
                        }
                    />
                </label>
                <label>
                    Vertical position
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={position.y}
                        disabled={!bitmap || saving}
                        onChange={(event) =>
                            setPosition({ ...position, y: Number(event.target.value) })
                        }
                    />
                </label>
                <div className="avatar-crop-actions">
                    <button
                        disabled={!bitmap || saving}
                        onClick={() => setPosition({ x: 0.5, y: 0.5, zoom: 1 })}
                    >
                        Center crop
                    </button>
                    <button
                        disabled={!bitmap || saving}
                        onClick={() => {
                            if (bitmap)
                                setPosition({
                                    x: 0.5,
                                    y: 0.5,
                                    zoom:
                                        Math.min(bitmap.width, bitmap.height) /
                                        Math.max(bitmap.width, bitmap.height),
                                });
                        }}
                    >
                        Fit whole image
                    </button>
                </div>
                {error && <p role="alert">{error}</p>}
                <div className="avatar-crop-actions">
                    <button disabled={saving} onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="primary"
                        disabled={!bitmap || saving}
                        onClick={() => void save()}
                    >
                        {saving ? 'Saving…' : 'Save picture'}
                    </button>
                </div>
            </section>
        </div>,
        document.body,
    );
}
