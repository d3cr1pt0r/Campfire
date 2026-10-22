import type { ReactNode } from 'react';
import type { Channel, State } from './types';
import type { ApiClient } from './api';
import { ChannelTree } from './ChannelTree';

export function ChannelGroups(props: {
    state: State;
    unread: Record<string, number>;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    storageKey: string;
    renderChannel: (channel: Channel) => ReactNode;
    api: ApiClient;
    refresh: () => Promise<void>;
    permission: (id: string) => boolean;
}) {
    return <ChannelTree {...props} mode="sidebar" />;
}
