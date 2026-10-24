import type { Dispatch, SetStateAction } from 'react';
import type { Preferences, User } from './types';
import { Avatar } from './Avatar';
import { displayName } from './profiles';
import { messageAvatarMode } from './messageAppearance';
import { Toggle } from './forms';
import { roleText } from './theme';

export function MessageAppearanceSettings({
    prefs,
    setPrefs,
    user,
    color,
}: {
    prefs: Preferences;
    setPrefs: Dispatch<SetStateAction<Preferences>>;
    user: User;
    color: string | undefined;
}) {
    const mode = messageAvatarMode(prefs.messageAvatars);
    return (
        <section
            className="settings-section message-appearance-settings"
            aria-labelledby="message-appearance-title"
        >
            <h3 id="message-appearance-title">Messages</h3>
            <Toggle
                title="Show role colors"
                value={prefs.showRoleColors !== false}
                set={(value) => setPrefs((previous) => ({ ...previous, showRoleColors: value }))}
            />
            <label>
                Message avatars
                <select
                    aria-label="Message avatars"
                    value={mode}
                    onChange={(event) =>
                        setPrefs((previous) => ({
                            ...previous,
                            messageAvatars: messageAvatarMode(event.target.value),
                        }))
                    }
                >
                    <option value="normal">Normal · Full avatars</option>
                    <option value="compact">Compact · Smaller avatars, tighter spacing</option>
                    <option value="hidden">Hidden · No avatars, tightest spacing</option>
                </select>
            </label>
            <p className="field-help">Applies to text messages, direct messages, and threads.</p>
            <div
                className="message-avatar-preview"
                role="group"
                aria-label="Message layout preview"
            >
                {['A little more room for conversation.', 'Choose the layout that suits you.'].map(
                    (text, index) => (
                        <article className={`message message-avatars-${mode}`} key={text}>
                            {mode !== 'hidden' && <Avatar user={user} color={color} />}
                            <div className="message-body">
                                <div className="message-line">
                                    <span className="message-meta">
                                        <strong
                                            style={roleText(
                                                prefs.showRoleColors === false ? undefined : color,
                                            )}
                                        >
                                            {displayName(user)}
                                        </strong>
                                    </span>
                                    <span className="message-text">{text}</span>
                                    <time className="message-time">
                                        <span className={index ? 'message-time-repeat' : undefined}>
                                            11:42
                                        </span>
                                    </time>
                                </div>
                            </div>
                        </article>
                    ),
                )}
            </div>
        </section>
    );
}
