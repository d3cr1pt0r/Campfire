// KLIPY serves GIF media from these hosts. Clients load media from them directly, as
// KLIPY's standard integration requires, so the content security policy allows them too.
export const klipyMediaHosts = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'];

export function isKlipyMedia(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            klipyMediaHosts.includes(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.port
        );
    } catch {
        return false;
    }
}
