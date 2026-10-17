/// <reference types="vite/client" />
interface Window {
    driskord?: {
        getIdleState?: () => Promise<{ seconds: number; locked: boolean } | null>;
        storage: {
            getItem(key: string): string | null;
            setItem(key: string, value: string): boolean;
            removeItem(key: string): boolean;
        };
    };
}
