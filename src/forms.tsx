import type { State } from './types';
export function Toggle({
    title,
    value,
    set,
}: {
    title: string;
    value: boolean;
    set: (v: boolean) => void;
}) {
    return (
        <label className="toggle-label">
            <span>{title}</span>
            <button
                type="button"
                role="switch"
                aria-checked={value}
                aria-label={title}
                className={`toggle ${value ? 'on' : ''}`}
                onClick={() => set(!value)}
            >
                <i />
            </button>
        </label>
    );
}
export function SimpleForm({
    label,
    initialValue,
    submit,
    busy,
    onSubmit,
}: {
    label: string;
    initialValue?: string;
    submit: string;
    busy: boolean;
    onSubmit: (v: string) => unknown;
}) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void onSubmit(String(new FormData(e.currentTarget).get('value')));
            }}
        >
            <label>
                {label}
                {label === 'Message' ? (
                    <textarea
                        name="value"
                        autoFocus
                        defaultValue={initialValue}
                        required
                        maxLength={4000}
                        rows={5}
                    />
                ) : (
                    <input
                        name="value"
                        autoFocus
                        defaultValue={initialValue}
                        required
                        maxLength={32}
                    />
                )}
            </label>
            <button className="primary" disabled={busy}>
                {busy ? 'Working…' : submit}
            </button>
        </form>
    );
}
export function RoleForm({
    role,
    busy,
    owner,
    onSave,
}: {
    role?: State['roles'][number];
    busy: boolean;
    owner: boolean;
    onSave: (v: unknown) => unknown;
}) {
    return (
        <>
            <h2 id="action-dialog-title">{role ? 'Edit role' : 'Create a role'}</h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void onSave({
                        name: f.get('name'),
                        color: f.get('color'),
                        permissions: f.getAll('permission'),
                    });
                }}
            >
                <label>
                    Role name
                    <input name="name" defaultValue={role?.name} maxLength={32} required />
                </label>
                <label>
                    Name color
                    <input name="color" type="color" defaultValue={role?.color || '#8b82f6'} />
                </label>
                {[
                    ['send', 'Send messages & files'],
                    ['voice', 'Join voice & video calls'],
                    ['manage', 'Manage server, channels, roles & messages'],
                ].map(([p, label]) => (
                    <label className="checkbox-label" key={p}>
                        <input
                            type="checkbox"
                            name="permission"
                            value={p}
                            defaultChecked={role ? role.permissions.includes(p) : p !== 'manage'}
                            disabled={p === 'manage' && !owner}
                        />
                        {label}
                    </label>
                ))}
                <button className="primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save role'}
                </button>
            </form>
        </>
    );
}
