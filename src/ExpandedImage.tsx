import { useState } from 'react';
import { ExpandedViewer } from './ExpandedViewer';

export function ExpandedImage({
    source,
    name,
    onClose,
    loading = false,
    error = '',
}: {
    source: string;
    name: string;
    onClose: () => void;
    loading?: boolean;
    error?: string;
}) {
    const [notice, setNotice] = useState('');
    return (
        <ExpandedViewer
            kind="image"
            name={name}
            label={`Expanded image: ${name}`}
            onClose={onClose}
            notice={error || notice || (loading ? 'Loading original image…' : '')}
        >
            {(fullscreen) =>
                source ? (
                    <img
                        src={source}
                        alt={name}
                        onDoubleClick={fullscreen}
                        onError={() =>
                            setNotice(
                                'This image could not be displayed. Return to chat to download the attachment.',
                            )
                        }
                    />
                ) : (
                    <span role="status">
                        {error ? 'Image unavailable' : 'Loading original image…'}
                    </span>
                )
            }
        </ExpandedViewer>
    );
}
