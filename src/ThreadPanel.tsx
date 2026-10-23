import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Pin, Search, X } from 'lucide-react';
import { ChatMessage, ChatMessages } from './ChatMessages';
import { ThreadReplyComposer, useThreadReply } from './ThreadReply';
import { useConversation } from './useConversation';
import { useConversationRead } from './useUnread';
import { removeFiles } from './conversation';
import type { ApiClient } from './api';
import type { AppSocket, Message, State, User } from './types';
import type { MessageAvatarMode } from './messageAppearance';
import type { PollTarget } from './PollDialog';

type Props = {
    messageAvatars?: MessageAvatarMode;
    showRoleColors?: boolean;
    currentVoiceChannel?: string | null;
    onJoinVoice?: (channel: string) => void;
    focusRequest: number;
    parent: Message;
    markRead: (room: string, through: number, thread?: string | null) => void;
    api: ApiClient;
    socket: AppSocket | null;
    state: State;
    permission: (permission: string) => boolean;
    user: (id: string) => User | undefined;
    color: (user?: User) => string | undefined;
    dm: (id: string) => void;
    download: (id: string, name: string) => Promise<void>;
    act: (fn: () => Promise<unknown>) => Promise<void>;
    setModal: (modal: string | null) => void;
    setEdit: (message: Message | null) => void;
    openPoll: (target: PollTarget) => void;
    connected: boolean;
    notify: (text: string) => void;
    onClose: () => void;
    formattingToolbar: boolean;
    setFormattingToolbar: (shown: boolean) => void;
};

export function ThreadPanel(props: Props) {
    const { parent, api, socket, state, connected, onClose } = props;
    const [root, setRoot] = useState(parent);
    const [rootError, setRootError] = useState('');
    const [search, setSearch] = useState('');
    const [pins, setPins] = useState(false);
    const close = useRef(onClose);
    close.current = onClose;
    const notify = useRef(props.notify);
    notify.current = props.notify;
    const reply = useThreadReply({ ...props, parent: root });
    const conversation = useConversation(api, socket, parent.room, true, search, pins, parent.id);
    useConversationRead(
        parent.room,
        conversation.messages,
        connected && conversation.loaded && !conversation.loading && !search && !pins,
        props.markRead,
        parent.id,
    );

    useEffect(() => {
        let controller: AbortController | undefined;
        // Live edits/counts received during a fetch take precedence over its snapshot.
        let revision = 0;
        const load = async () => {
            controller?.abort();
            const current = new AbortController();
            controller = current;
            const started = revision;
            try {
                const message = await api<Message>(
                    `/messages/${parent.id}`,
                    'GET',
                    undefined,
                    current.signal,
                );
                if (current.signal.aborted) return;
                if (started === revision) setRoot(message);
                setRootError('');
            } catch (e) {
                if (current.signal.aborted) return;
                if ((e as { status?: number }).status === 404) close.current();
                else setRootError((e as Error).message);
            }
        };
        const update = (message: Message) => {
            if (message.id === parent.id) {
                revision++;
                setRoot(message);
            }
        };
        const remove = (event: { id: string; room: string }) => {
            if (event.id === parent.id && event.room === parent.room) close.current();
        };
        const expire = (event: { room: string; ids: string[] }) => {
            if (event.room !== parent.room || !event.ids.includes(parent.id)) return;
            notify.current('This thread reached the end of its retention period and was deleted.');
            close.current();
        };
        const strip = (event: { room: string; ids: string[] }) => {
            if (event.room !== parent.room || !event.ids.includes(parent.id)) return;
            revision++;
            setRoot((message) => removeFiles(message));
        };
        socket?.on('connect', load);
        socket?.on('message:update', update);
        socket?.on('message:delete', remove);
        socket?.on('messages:expired', expire);
        socket?.on('messages:files-removed', strip);
        void load();
        return () => {
            controller?.abort();
            socket?.off('connect', load);
            socket?.off('message:update', update);
            socket?.off('message:delete', remove);
            socket?.off('messages:expired', expire);
            socket?.off('messages:files-removed', strip);
        };
    }, [api, socket, parent.id, parent.room]);

    const clearFilters = () => {
        setSearch('');
        setPins(false);
    };
    return (
        <aside
            className="thread-panel"
            aria-label="Message thread"
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = reply.canPost && !reply.busy ? 'copy' : 'none';
                }
            }}
            onDrop={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    event.stopPropagation();
                    reply.addFiles(Array.from(event.dataTransfer.files));
                }
            }}
        >
            <header className="thread-header">
                <MessageCircle size={19} />
                <strong>Thread</strong>
                <span>
                    {root.replyCount || 0} {root.replyCount === 1 ? 'reply' : 'replies'}
                </span>
                <div className="thread-tools">
                    <label>
                        <Search size={16} />
                        <input
                            aria-label="Search thread"
                            placeholder="Search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </label>
                    <button
                        title="Pinned replies"
                        aria-label="Pinned replies"
                        aria-pressed={pins}
                        onClick={() => setPins(!pins)}
                    >
                        <Pin size={17} />
                    </button>
                </div>
                <button title="Close thread" aria-label="Close thread" onClick={onClose}>
                    <X size={20} />
                </button>
            </header>
            <section className="thread-original" aria-label="Original message">
                <div className="thread-original-label">Original message</div>
                <ChatMessage {...props} message={root} thread />
            </section>
            {rootError && (
                <p className="inline-notice" role="alert">
                    {rootError}
                </p>
            )}
            <ChatMessages
                currentVoiceChannel={props.currentVoiceChannel}
                onJoinVoice={props.onJoinVoice}
                {...props}
                key={`${search}:${pins}`}
                thread
                retentionUnit={root.retention}
                conversation={conversation}
                search={search}
                pins={pins}
                currentChannel={state.channels.find((channel) => channel.id === parent.room)}
                dmUser={parent.room.startsWith('dm:') ? state.me : undefined}
                visibleMessages={conversation.messages}
                clearFilters={clearFilters}
            />
            <ThreadReplyComposer
                {...props}
                parent={root}
                reply={reply}
                placeholder="Reply to thread"
            />
        </aside>
    );
}
