import { mentionSegments } from './mentions';
import type { User } from './types';
import { messageParts } from './messageText';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ExpandedImage } from './ExpandedImage';
import { useImage } from './useImage';
export const AssetContext = createContext({ url: '', token: '' });
export function AuthImage({
    path,
    alt,
    className = '',
    expandable = false,
    originalPath,
}: {
    path: string;
    alt: string;
    className?: string;
    expandable?: boolean;
    originalPath?: string;
}) {
    const { url, token } = useContext(AssetContext);
    const container = useRef<HTMLSpanElement>(null);
    const [near, setNear] = useState(false);
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        const element = container.current;
        if (!element) return;
        if (!('IntersectionObserver' in window)) {
            setNear(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNear(true);
                    observer.disconnect();
                }
            },
            { root: element.closest('.messages'), rootMargin: '240px' },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const preview = useImage(url, token, near ? path : null);
    const original = useImage(url, token, expanded && originalPath ? originalPath : null);
    const image = preview.source ? (
        <img src={preview.source} alt={alt} className={className} decoding="async" />
    ) : (
        <span className={`image-placeholder ${className}`} aria-label={alt}>
            {expandable
                ? preview.error
                    ? 'Preview unavailable — open original'
                    : 'Image preview'
                : ''}
        </span>
    );
    return (
        <span ref={container} className={expandable ? 'auth-image attachment-image' : 'auth-image'}>
            {expandable ? (
                <button
                    type="button"
                    className="image-preview-button"
                    title="Click to enlarge image"
                    aria-label={`Enlarge image: ${alt}`}
                    aria-haspopup="dialog"
                    onClick={() => setExpanded(true)}
                >
                    {image}
                </button>
            ) : (
                image
            )}
            {expanded && (
                <ExpandedImage
                    source={originalPath ? original.source : preview.source}
                    name={alt}
                    loading={!!originalPath && !original.source && !original.error}
                    error={original.error}
                    onClose={() => setExpanded(false)}
                />
            )}
        </span>
    );
}
export function Emoji({
    value,
    custom,
}: {
    value: string;
    custom: { id: string; name: string }[];
}) {
    const item =
        value.startsWith(':') && value.endsWith(':')
            ? custom.find((e) => `:${e.name}:` === value)
            : undefined;
    return item ? (
        <AuthImage path={`/emojis/${item.id}`} alt={value} className="custom-emoji" />
    ) : (
        <>{value}</>
    );
}
export function ChatContent({
    text,
    custom,
    users = [],
}: {
    text: string;
    users?: User[];
    custom: { id: string; name: string }[];
}) {
    return (
        <>
            {messageParts(text).map((part, i) =>
                part.link ? (
                    <a key={i} href={part.text} target="_blank" rel="noopener noreferrer">
                        {part.text}
                    </a>
                ) : (
                    <span key={i}>
                        {mentionSegments(part.text, users).map((segment, index) =>
                            segment.user ? (
                                <span
                                    key={index}
                                    className="message-mention"
                                    title={`@${segment.user.username}`}
                                >
                                    {segment.text}
                                </span>
                            ) : (
                                <Emoji key={index} value={segment.text} custom={custom} />
                            ),
                        )}
                    </span>
                ),
            )}
        </>
    );
}
