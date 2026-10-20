import type { ClipboardEvent } from 'react';

export type ServerAddress = {
    protocol: 'https:' | 'http:';
    host: string;
    port: string;
};

export function splitServerAddress(value: string): ServerAddress {
    if (value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'https:' || url.protocol === 'http:')
                return {
                    protocol: url.protocol,
                    host: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
                };
        } catch {
            // Start with an empty host if a saved address is invalid.
        }
    }
    return { protocol: 'https:', host: '', port: '3001' };
}

export function serverAddressUrl({ protocol, host, port }: ServerAddress) {
    const hostname = host.trim();
    if (!hostname) return '';
    const address =
        hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
    return `${protocol}//${address}:${port}`;
}

export function ServerAddressInput({
    value,
    onChange,
    onPasteLink,
    disabled,
}: {
    value: ServerAddress;
    onChange: (address: ServerAddress) => void;
    onPasteLink: (text: string) => void;
    disabled: boolean;
}) {
    const paste = (event: ClipboardEvent<HTMLInputElement>) => {
        const text = event.clipboardData.getData('text').trim();
        if (!/[:/#]/.test(text)) return;
        event.preventDefault();
        onPasteLink(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `${value.protocol}//${text}`);
    };
    return (
        <div className="server-address-group" role="group" aria-labelledby="server-address-label">
            <span id="server-address-label" className="server-address-label">
                Server address
            </span>
            <div className="server-address-control">
                <select
                    aria-label="Protocol"
                    value={value.protocol}
                    onChange={(event) =>
                        onChange({
                            ...value,
                            protocol: event.target.value as ServerAddress['protocol'],
                        })
                    }
                    disabled={disabled}
                >
                    <option value="https:">HTTPS</option>
                    <option value="http:">HTTP</option>
                </select>
                <input
                    name="host"
                    aria-label="IP address or domain"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="IP address or domain"
                    value={value.host}
                    onChange={(event) => onChange({ ...value, host: event.target.value })}
                    onPaste={paste}
                    required
                    autoFocus
                    disabled={disabled}
                />
                <span className="server-address-colon" aria-hidden="true">
                    :
                </span>
                <input
                    name="port"
                    aria-label="Port"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    value={value.port}
                    onChange={(event) => onChange({ ...value, port: event.target.value })}
                    required
                    disabled={disabled}
                />
            </div>
            <input type="hidden" name="url" value={serverAddressUrl(value)} />
        </div>
    );
}
