export async function selectAudioOutput(
    element: Pick<HTMLMediaElement, 'setSinkId'> & { readonly sinkId?: string },
    output: string,
): Promise<boolean> {
    if (typeof element.setSinkId !== 'function') return false;
    const requested = output === 'default' ? '' : output;
    // Fresh media elements already use the system output. Some backends fail
    // even a redundant switch, particularly before a source starts playing.
    if ((element.sinkId === 'default' ? '' : (element.sinkId ?? '')) === requested) return false;
    try {
        await element.setSinkId(requested);
        return false;
    } catch (error) {
        const name = (error as { name?: string })?.name;
        if (
            !requested ||
            !['NotFoundError', 'OverconstrainedError', 'AbortError'].includes(name || '')
        )
            throw error;
        if (element.sinkId === '' || element.sinkId === 'default') return true;
        await element.setSinkId('');
        return true;
    }
}

export function playbackError(error: unknown): string {
    const value = error as { name?: string; message?: string } | undefined;
    if (value?.name === 'NotAllowedError') return 'Audio playback was blocked. Click Play audio.';
    return `Audio playback failed${value?.name ? ` [${value.name}]` : ''}. Click Play audio to retry.${value?.message ? ` ${value.message}` : ''}`;
}

export function syncPlaybackTracks(
    audio: MediaStream,
    video: MediaStream,
    tracks: MediaStreamTrack[],
    preview = false,
): void {
    const live = tracks.filter((track) => track.readyState !== 'ended');
    for (const [target, kind] of [
        [audio, 'audio'],
        [video, 'video'],
    ] as const) {
        const desired =
            kind === 'audio' && preview ? [] : live.filter((track) => track.kind === kind);
        target.getTracks().forEach((track) => {
            if (!desired.includes(track)) target.removeTrack(track);
        });
        desired.forEach((track) => {
            if (!target.getTracks().includes(track)) target.addTrack(track);
        });
    }
}
