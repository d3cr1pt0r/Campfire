export type ThemePreference = 'system' | 'dark' | 'light';
export function themePreference(value: unknown): ThemePreference {
    return value === 'dark' || value === 'light' ? value : 'system';
}
export function applyTheme(
    preference: unknown,
    root: Pick<HTMLElement, 'dataset'>,
    systemDark: boolean,
) {
    const selected = themePreference(preference);
    root.dataset.theme =
        selected === 'dark' || (selected === 'system' && systemDark) ? 'ember' : 'canvas';
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
