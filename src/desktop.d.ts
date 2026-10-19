/// <reference types="vite/client" />
interface Window {
    campfire?: {
        readClipboardAttachments?: () => Promise<{
            files: { name: string; data: Uint8Array; type: string }[];
            text: string;
        }>;
        getIdleState?: () => Promise<{ seconds: number; locked: boolean } | null>;
        pins?: {
            check(origin: string): Promise<import('./serverTrust').ServerCheck>;
            get(origin: string): Promise<string | null>;
            trust(
                origin: string,
                fingerprint: string,
            ): Promise<{ ok: boolean; reason?: string; restarting?: boolean }>;
            forget(origin: string): Promise<{ ok: boolean; reason?: string; restarting?: boolean }>;
        };
        storage: {
            getItem(key: string): string | null;
            setItem(key: string, value: string): boolean;
            removeItem(key: string): boolean;
        };
    };
}
