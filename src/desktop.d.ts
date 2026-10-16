/// <reference types="vite/client" />
interface Window {
  driskord?: {
    storage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): boolean;
      removeItem(key: string): boolean;
    };
  };
}
