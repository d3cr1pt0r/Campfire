import type { CSSProperties } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export function themePreference(value: unknown): ThemePreference {
    return value === 'system' || value === 'light' ? value : 'dark';
}
export function applyTheme(
    preference: unknown,
    root: Pick<HTMLElement, 'dataset'>,
    systemDark: boolean,
) {
    const selected = themePreference(preference);
    root.dataset.theme =
        selected === 'dark' || (selected === 'system' && systemDark) ? 'graphite' : 'paper';
}
export function watchTheme(
    preference: unknown,
    root: Pick<HTMLElement, 'dataset'>,
    query: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>,
) {
    const update = () => applyTheme(preference, root, query.matches);
    update();
    if (themePreference(preference) !== 'system') return () => {};
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
}

// Role colours are stored exactly as picked. The active theme keeps each hue but sets the
// lightness and caps the chroma (the --role-* tokens), so every pick reads well in both themes.
export function roleText(color?: string): CSSProperties | undefined {
    return color
        ? { color: `oklch(from ${color} var(--role-l) min(c, var(--role-c)) h)` }
        : undefined;
}
export function roleAvatar(color?: string): CSSProperties {
    if (!color) return { background: 'var(--avatar-bg)', color: 'var(--avatar-ink)' };
    return {
        background: `oklch(from ${color} var(--role-avatar-l) min(c, var(--role-avatar-c)) h)`,
        color: `oklch(from ${color} var(--role-avatar-ink-l) min(c, var(--role-avatar-ink-c)) h)`,
    };
}
