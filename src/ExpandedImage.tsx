import { useState } from 'react';
import { Download } from 'lucide-react';
import { ExpandedViewer } from './ExpandedViewer';

export function ExpandedImage({
    source,
    name,
    onClose,
    loading = false,
    error = '',
    onDownload,
}: {
    source: string;
    name: string;
    onClose: () => void;
    loading?: boolean;
    error?: string;
    onDownload?: () => void;
}) {
    const [notice, setNotice] = useState('');
    return (
        <ExpandedViewer
            kind="image"
            name={name}
            label={`Expanded image: ${name}`}
            onClose={onClose}
            notice={error || notice || (loading ? 'Loading original image…' : '')}
            controls={
                onDownload && (
                    <button type="button" className="viewer-download" onClick={onDownload}>
                        <Download size={16} />
                        Download
                    </button>
                )
            }
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
