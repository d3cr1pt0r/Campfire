import { mentionSegments } from './mentions';
import type { User } from './types';
import { messageParts } from './messageText';
import { parseMessage, type Inline, type List } from './messageFormat';
import {
    createContext,
    Fragment,
    useContext,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { useImage } from './useImage';
import { useAvatarImage } from './useAvatarImage';
export const AssetContext = createContext({ url: '', token: '', account: '' });
// Becomes true once the element comes within 240px of the message list's viewport.
export function useNearViewport(element: RefObject<HTMLElement | null>, immediate = false) {
    const [near, setNear] = useState(false);
    useEffect(() => {
        const target = element.current;
        if (!target || immediate) return;
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
            { root: target.closest('.messages'), rootMargin: '240px' },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [element, immediate]);
    return immediate || near;
}
export function AuthImage({
    path,
    alt,
    className = '',
}: {
    path: string;
    alt: string;
    className?: string;
}) {
    const { url, token, account } = useContext(AssetContext);
    const container = useRef<HTMLSpanElement>(null);
    const avatar = path.startsWith('/avatars/');
    const near = useNearViewport(container, avatar);
    const preview = useImage(url, token, !avatar && near ? path : null);
    const avatarSource = useAvatarImage(url, token, account, avatar ? path : null);
    const source = avatar ? avatarSource : preview.source;
    return (
        <span ref={container} className="auth-image">
            {source ? (
                <img src={source} alt={alt} className={className} decoding="async" />
            ) : (
                <span className={`image-placeholder ${className}`} aria-label={alt} />
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
