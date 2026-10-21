/// <reference types="vite/client" />
interface Window {
    campfire?: {
        avatars?: {
            read(key: string): Promise<Uint8Array | null>;
            write(key: string, bytes: Uint8Array): Promise<boolean>;
        };
        readClipboardAttachments?: () => Promise<{
            files: { name: string; data: Uint8Array; type: string }[];
            text: string;
        }>;
        getIdleState?: () => Promise<{ seconds: number; locked: boolean } | null>;
        insecureHttp?: {
            isAllowed(origin: string): boolean;
            setAllowed(origin: string, enabled: boolean): Promise<boolean>;
        };
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
