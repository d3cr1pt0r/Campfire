import { useEffect, useState } from 'react';
import { createApiClient } from './api';

export function useImage(url: string, token: string, path: string | null) {
    const key = `${url}\n${token}\n${path}`;
    const [result, setResult] = useState({ key: '', source: '', error: '' });
    useEffect(() => {
        if (!path) return;
        const controller = new AbortController();
        let objectUrl = '';
        void createApiClient(url, token)
            .blob(path, controller.signal)
            .then((blob) => {
                if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type))
                    throw new Error('Image unavailable');
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setResult({ key, source: objectUrl, error: '' });
            })
            .catch((error) => {
                if (!controller.signal.aborted)
                    setResult({ key, source: '', error: error.message });
            });
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [url, token, path, key]);
    return result.key === key ? result : { source: '', error: '' };
}
