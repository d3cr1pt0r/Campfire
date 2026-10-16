import { messageParts } from './messageText';
import { createContext, useContext, useEffect, useState } from 'react';
export const AssetContext = createContext({ url: '', token: '' });
export function AuthImage({ path, alt, className = '' }: { path: string; alt: string; className?: string }) {
    const { url, token } = useContext(AssetContext);
    const [source, setSource] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = '';
        setSource('');
        void fetch(`${url.replace(/\/$/, '')}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
            .then(async res => {
                if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(res.headers.get('content-type')?.split(';')[0] || '')) throw new Error('Preview unavailable');
                const blob = await res.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
            }).catch(() => {});
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [url, token, path]);
    return source ? <img src={source} alt={alt} className={className} loading="lazy" /> : <span className={`image-placeholder ${className}`} aria-label={alt} />;
}
export function Emoji({ value, custom }: { value: string; custom: {id: string; name: string}[] }) {
    const item = value.startsWith(':') && value.endsWith(':') ? custom.find(e => `:${e.name}:` === value) : undefined;
    return item ? <AuthImage path={`/emojis/${item.id}`} alt={value} className="custom-emoji" /> : <>{value}</>;
}
export function ChatContent({ text, custom }: { text: string; custom: {id:string;name:string}[] }) {
    return <>{messageParts(text).map((part, i) => part.link ? <a key={i} href={part.text} target="_blank" rel="noopener noreferrer">{part.text}</a> : <Emoji key={i} value={part.text} custom={custom} />)}</>;
}
