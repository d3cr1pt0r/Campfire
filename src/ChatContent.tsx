import { createApiClient } from './api';
import { messageParts } from './messageText';
import { createContext, useContext, useEffect, useState } from 'react';
import { ExpandedImage } from './ExpandedImage';
export const AssetContext = createContext({ url: '', token: '' });
export function AuthImage({
    path,
    alt,
    className = '',
    expandable = false,
}: {
    path: string;
    alt: string;
    className?: string;
    expandable?: boolean;
}) {
    const { url, token } = useContext(AssetContext);
    const [source, setSource] = useState('');
    const [expandedSource, setExpandedSource] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = '';
        setSource('');
        setExpandedSource('');
        void createApiClient(url, token)
            .blob(path, controller.signal)
            .then((blob) => {
                if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type))
                    throw new Error('Preview unavailable');
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setSource(objectUrl);
            })
            .catch(() => {});
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [url, token, path]);
    if (!source) return <span className={`image-placeholder ${className}`} aria-label={alt} />;
    const image = <img src={source} alt={alt} className={className} loading="lazy" />;
    return expandable ? (
        <>
            <button
                type="button"
                className="image-preview-button"
                title="Click to enlarge image"
                aria-label={`Enlarge image: ${alt}`}
                aria-haspopup="dialog"
                onClick={() => setExpandedSource(source)}
            >
                {image}
            </button>
            {expandedSource === source && (
                <ExpandedImage source={source} name={alt} onClose={() => setExpandedSource('')} />
            )}
        </>
    ) : (
        image
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
}: {
    text: string;
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
                    <Emoji key={i} value={part.text} custom={custom} />
                ),
            )}
        </>
    );
}
