import { mentionSegments } from './mentions';
import type { User } from './types';
import { messageParts } from './messageText';
import { parseMessage, type Inline, type List } from './messageFormat';
import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
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
type Custom = { id: string; name: string }[];
function PlainText({ text, custom, users }: { text: string; users: User[]; custom: Custom }) {
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
function InlineContent({
    content,
    custom,
    users,
}: {
    content: Inline[];
    users: User[];
    custom: Custom;
}) {
    return content.map((part, i) => {
        if (part.type === 'text')
            return <PlainText key={i} text={part.text} users={users} custom={custom} />;
        if (part.type === 'code')
            return (
                <code key={i} className="message-code">
                    {part.text}
                </code>
            );
        const Tag = part.type === 'bold' ? 'strong' : part.type === 'italic' ? 'em' : 's';
        return (
            <Tag key={i}>
                <InlineContent content={part.children} users={users} custom={custom} />
            </Tag>
        );
    });
}
function CodeBlock({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="message-code-block">
            <pre>
                <code>{text}</code>
            </pre>
            <button
                type="button"
                className="code-copy"
                title={copied ? 'Copied' : 'Copy code'}
                aria-label={copied ? 'Copied' : 'Copy code'}
                onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    } catch {
                        /* Clipboard access can be refused; the code remains selectable. */
                    }
                }}
            >
                {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
        </div>
    );
}
// Consecutive lines share one pre-wrapped run; lists, quotes and code blocks break lines themselves.
export function ChatContent({
    text,
    custom,
    users = [],
}: {
    text: string;
    users?: User[];
    custom: Custom;
}) {
    const lines = (rows: Inline[][]) =>
        rows.map((row, i) => (
            <Fragment key={i}>
                {i > 0 && '\n'}
                <InlineContent content={row} users={users} custom={custom} />
            </Fragment>
        ));
    return parseMessage(text).map((block, i, blocks) => {
        if (block.type === 'paragraph')
            return (
                <Fragment key={i}>
                    {blocks[i - 1]?.type === 'paragraph' && '\n'}
                    <InlineContent content={block.content} users={users} custom={custom} />
                </Fragment>
            );
        if (block.type === 'code') return <CodeBlock key={i} text={block.text} />;
        if (block.type === 'quote')
            return (
                <blockquote key={i} className="message-quote">
                    {lines(block.lines)}
                </blockquote>
            );
        return <MessageList key={i} list={block} users={users} custom={custom} />;
    });
}
function MessageList({ list, custom, users }: { list: List; users: User[]; custom: Custom }) {
    const items = list.items.map((item, index) => (
        <li key={index}>
            <InlineContent content={item.content} users={users} custom={custom} />
            {item.children.map((child, childIndex) => (
                <MessageList key={childIndex} list={child} users={users} custom={custom} />
            ))}
        </li>
    ));
    return list.type === 'bullets' ? (
        <ul className="message-list">{items}</ul>
    ) : (
        <ol className="message-list" start={list.start}>
            {items}
        </ol>
    );
}
