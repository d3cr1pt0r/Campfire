import { useEffect, useState } from 'react';

export type UpdateState = {
    status:
        | 'unsupported'
        | 'idle'
        | 'checking'
        | 'current'
        | 'downloading'
        | 'ready'
        | 'installing'
        | 'error';
    currentVersion: string;
    version?: string;
    percent?: number;
    message: string;
};

export function DesktopUpdates({ banner = false }: { banner?: boolean }) {
    const updates = window.campfire?.updates;
    const [state, setState] = useState<UpdateState>();
    useEffect(() => {
        if (!updates) return;
        let active = true;
        // Subscribe first; avoid overwriting a newer event with a stale initial response.
        let changed = false;
        const unsubscribe = updates.subscribe((next) => {
            changed = true;
            if (active) setState(next);
        });
        void updates
            .getState()
            .then((next) => {
                if (active && !changed) setState(next);
            })
            .catch(() => {});
        return () => {
            active = false;
            unsubscribe();
        };
    }, [updates]);
    if (!updates || !state || (banner && state.status !== 'ready')) return null;
    const busy = ['checking', 'downloading', 'installing'].includes(state.status);
    const text =
        state.status === 'ready'
            ? `Campfire ${state.version} is ready to install.`
            : state.status === 'downloading'
              ? `Downloading Campfire ${state.version}… ${Math.round(state.percent || 0)}%`
              : state.status === 'checking'
                ? 'Checking for updates…'
                : state.status === 'current'
                  ? 'You’re up to date.'
                  : state.status === 'installing'
                    ? 'Restarting Campfire…'
                    : state.message ||
                      'Updates download automatically and install when you quit Campfire.';
    return (
        <section
            className={banner ? 'desktop-update-banner' : 'account-section'}
            aria-label="Client updates"
        >
            <div aria-live="polite">
                {!banner && <h3>Client updates</h3>}
                {!banner && <p className="muted">Version {state.currentVersion}</p>}
                <p>{text}</p>
            </div>
            {state.status === 'ready' ? (
                <button className="primary" onClick={() => void updates.install()}>
                    Restart to update
                </button>
            ) : (
                state.status !== 'unsupported' && (
                    <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void updates.check()}
                    >
                        Check for updates
                    </button>
                )
            )}
        </section>
    );
}
