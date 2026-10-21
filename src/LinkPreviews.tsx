import { useContext, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { AssetContext, useNearViewport } from './ChatContent';
import { useImage } from './useImage';
import type { LinkPreview } from './types';

// Cards for links in a message. The server fetched each page; images come from the server.
export function LinkPreviews({
    previews,
    onHide,
}: {
    previews: LinkPreview[];
    // Shown to the author (and moderators) to remove the cards from the message.
    onHide?: () => void;
}) {
    return (
        <div className="link-previews">
            {previews.map((preview) => (
                <LinkPreviewCard key={preview.id} preview={preview} onHide={onHide} />
            ))}
        </div>
    );
}

function LinkPreviewCard({ preview, onHide }: { preview: LinkPreview; onHide?: () => void }) {
    const { url, token } = useContext(AssetContext);
    const card = useRef<HTMLDivElement>(null);
    const near = useNearViewport(card);
    const image = useImage(
        url,
        token,
        near && preview.image ? `/link-previews/${preview.id}/image` : null,
    );
    return (
        <div ref={card} className={`link-preview ${preview.image && preview.large ? 'large' : ''}`}>
            <div className="link-preview-text">
                <span className="link-preview-site">{preview.site}</span>
                <a
                    className="link-preview-title"
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {preview.title}
                </a>
                {preview.description && (
                    <p className="link-preview-description">{preview.description}</p>
                )}
            </div>
            {preview.image && (
                <a
                    className="link-preview-image"
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={
                        preview.large
                            ? { aspectRatio: `${preview.width} / ${preview.height}` }
                            : undefined
                    }
                >
                    {image.source && <img src={image.source} alt="" decoding="async" />}
                    {preview.video && (
                        <span className="link-preview-play">
                            <Play size={20} />
                        </span>
                    )}
                </a>
            )}
            {onHide && (
                <button
                    type="button"
                    className="link-preview-hide"
                    title="Remove previews"
                    aria-label="Remove link previews from this message"
                    onClick={onHide}
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
