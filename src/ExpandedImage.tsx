import { useState } from 'react';
import { ExpandedViewer } from './ExpandedViewer';

export function ExpandedImage({
    source,
    name,
    onClose,
}: {
    source: string;
    name: string;
    onClose: () => void;
}) {
    const [notice, setNotice] = useState('');
    return (
        <ExpandedViewer
            kind="image"
            name={name}
            label={`Expanded image: ${name}`}
            onClose={onClose}
            notice={notice}
        >
            {(fullscreen) => (
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
            )}
        </ExpandedViewer>
    );
}
