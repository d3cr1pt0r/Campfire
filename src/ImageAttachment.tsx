import { useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { AssetContext, useNearViewport } from './ChatContent';
import { ExpandedImage } from './ExpandedImage';
import { attachmentFrame } from './images';
import { useImage } from './useImage';
import type { Message } from './types';

type Attachment = Message['attachments'][number];

// An image attachment sized to its own aspect ratio. Animated images play from the
// original once near the screen; the static preview shows until it arrives.
export function ImageAttachment({
    attachment,
    onDownload,
    fallback,
}: {
    attachment: Attachment;
    onDownload: () => void;
    // Shown instead when no preview can be made, so the file stays downloadable.
    fallback: ReactNode;
}) {
    const { url, token } = useContext(AssetContext);
    const container = useRef<HTMLDivElement>(null);
    const near = useNearViewport(container);
    const [expanded, setExpanded] = useState(false);
    const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
    const original = `/attachments/${attachment.id}?inline=1`;
    // Images whose header could not be read have no size; GIFs among them are treated as animated.
    const animated = attachment.animated ?? (!attachment.width && attachment.mime === 'image/gif');
    const preview = useImage(url, token, near ? `/attachments/${attachment.id}/preview` : null);
    const full = useImage(url, token, (near && animated) || expanded ? original : null);
    const source = (animated && full.source) || preview.source;
    if (preview.error && !full.source && (!animated || full.error)) return <>{fallback}</>;
    const size =
        attachment.width && attachment.height
            ? { width: attachment.width, height: attachment.height }
            : loaded;
    const frame = size ? attachmentFrame(size.width, size.height) : null;
    const style = (
        frame
            ? {
                  aspectRatio: `${frame.width} / ${frame.height}`,
                  width: `min(100%, ${frame.width}px, calc(var(--attachment-max-height, 360px) * ${frame.width / frame.height}))`,
              }
            : undefined
    ) as CSSProperties | undefined;
    return (
        <div
            ref={container}
            className={`attachment-image ${frame ? '' : 'unsized'} ${source ? 'loaded' : ''}`}
            style={style}
        >
            <button
                type="button"
                className="image-preview-button"
                title="Click to enlarge image"
                aria-label={`Enlarge image: ${attachment.name}`}
                aria-haspopup="dialog"
                onClick={() => setExpanded(true)}
            >
                {source && (
                    <img
                        src={source}
                        alt={attachment.name}
                        decoding="async"
                        onLoad={(event) =>
                            setLoaded({
                                width: event.currentTarget.naturalWidth,
                                height: event.currentTarget.naturalHeight,
                            })
                        }
                    />
                )}
            </button>
            <button
                type="button"
                className="image-download"
                title="Download"
                aria-label={`Download ${attachment.name}`}
                onClick={onDownload}
            >
                <Download size={16} />
            </button>
            {expanded && (
                <ExpandedImage
                    source={full.source}
                    name={attachment.name}
                    loading={!full.source && !full.error}
                    error={full.error}
                    onDownload={onDownload}
                    onClose={() => setExpanded(false)}
                />
            )}
        </div>
    );
}
