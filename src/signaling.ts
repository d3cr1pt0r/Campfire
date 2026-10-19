// Constant-bitrate Opus keeps voice packet sizes independent of speech, so encrypted traffic
// does not reveal what is said through its packet lengths. RFC 7587 makes cbr a receiver
// preference, so it is added to the description we receive and our sender honours it.
export function preferConstantBitrate(sdp: string) {
    let result = sdp;
    for (const [, payload] of sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)) {
        const fmtp = new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)`, 'm');
        const parameters = result.match(fmtp)?.[1];
        if (parameters === undefined)
            result = result.replace(
                new RegExp(`^(a=rtpmap:${payload} opus/48000[^\\r\\n]*)(\\r?\\n)`, 'mi'),
                `$1$2a=fmtp:${payload} cbr=1$2`,
            );
        else if (!/(^|;)\s*cbr=/.test(parameters))
            result = result.replace(fmtp, `a=fmtp:${payload} ${parameters};cbr=1`);
    }
    return result;
}

export type PeerSignal = {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
};

// Keep one negotiation owner per peer and serialize incoming messages. In
// particular, finish applying an answer before handling the next remote offer.
export function createPeerSignaling(
    pc: RTCPeerConnection,
    polite: boolean,
    send: (data: PeerSignal) => void,
    prepareAnswer: () => Promise<void>,
    initialOfferer: boolean,
) {
    let makingOffer = false;
    let ignoreOffer = false;
    let closed = false;
    let pending: RTCIceCandidateInit[] = [];
    let incoming = Promise.resolve();
    return {
        async negotiate() {
            if (closed || makingOffer || pc.signalingState !== 'stable') return;
            // A newly arriving peer sends the initial offer. Responders wait
            // for it instead of independently offering an empty/duplicate track set.
            if (!initialOfferer && !pc.remoteDescription) return;
            try {
                makingOffer = true;
                await pc.setLocalDescription();
                if (!closed && pc.localDescription) send({ description: pc.localDescription });
            } finally {
                makingOffer = false;
            }
        },
        receive(data: PeerSignal): Promise<void> {
            const next = incoming.then(async () => {
                if (closed) return;
                if (data.description) {
                    const collision =
                        data.description.type === 'offer' &&
                        (makingOffer || pc.signalingState !== 'stable');
                    ignoreOffer = !polite && collision;
                    if (ignoreOffer) {
                        pending = [];
                        return;
                    }
                    const { description } = data;
                    await pc.setRemoteDescription(
                        description.sdp
                            ? { ...description, sdp: preferConstantBitrate(description.sdp) }
                            : description,
                    );
                    if (closed) return;
                    if (data.description.type === 'offer') {
                        // Reuse the offer's transceivers and attach local tracks
                        // before constructing the answer, in both directions.
                        await prepareAnswer();
                        if (closed) return;
                        await pc.setLocalDescription();
                        if (!closed && pc.localDescription)
                            send({ description: pc.localDescription });
                    }
                    const candidates = pending;
                    pending = [];
                    for (const candidate of candidates) {
                        if (!closed) await pc.addIceCandidate(candidate);
                    }
                } else if (data.candidate && !ignoreOffer) {
                    if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
                    else pending.push(data.candidate);
                }
            });
            incoming = next.catch(() => {}); // One rejected message must not poison the queue.
            return next;
        },
        close() {
            closed = true;
            pending = [];
        },
    };
}
