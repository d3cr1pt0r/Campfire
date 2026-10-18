/// <reference types="vite/client" />
interface Window {
    campfire?: {
        readClipboardAttachments?: () => Promise<{
            files: { name: string; data: Uint8Array; type: string }[];
            text: string;
        }>;
        getIdleState?: () => Promise<{ seconds: number; locked: boolean } | null>;
        storage: {
            getItem(key: string): string | null;
            setItem(key: string, value: string): boolean;
            removeItem(key: string): boolean;
        };
    };
}
