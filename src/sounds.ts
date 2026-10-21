// Campfire's sound effects, synthesized with Web Audio so they need no audio files.
// Each sound is a few notes played through a shared timbre, a soft echo and a
// compressor that keeps them clearly audible without clipping.

export type SoundName =
    | 'message'
    | 'mention'
    | 'incomingCall'
    | 'outgoingCall'
    | 'callDeclined'
    | 'callJoined'
    | 'callLeft'
    | 'memberJoined'
    | 'memberLeft'
    | 'mute'
    | 'unmute'
    | 'deafen'
    | 'undeafen'
    | 'shareStarted'
    | 'shareStopped';

type Timbre = 'marimba' | 'kalimba' | 'bell' | 'soft';
// Pitches are MIDI note numbers (69 is A4, 440 Hz); times and decays are seconds.
type Note = { at: number; pitch: number; decay: number; level: number; glide?: number };
export type Sound = {
    label: string;
    // When the app plays it, in the words a member would use.
    when: string;
    group: 'Messages' | 'Calls' | 'Voice' | 'Your controls' | 'Screen sharing';
    timbre: Timbre;
    notes: Note[];
    // Looping sounds repeat with this period until stopped.
    loop?: number;
};

// [frequency ratio, relative level, relative decay] for each partial.
const timbres: Record<Timbre, { attack: number; partials: [number, number, number][] }> = {
    kalimba: {
        attack: 0.003,
        partials: [
            [1, 1, 1],
            [2, 0.2, 0.5],
            [3.98, 0.12, 0.25],
        ],
    },
    bell: {
        attack: 0.002,
        partials: [
            [1, 1, 1],
            [2, 0.42, 0.7],
            [3, 0.2, 0.5],
            [4.16, 0.14, 0.35],
            [5.43, 0.07, 0.25],
        ],
    },
    soft: {
        attack: 0.006,
        partials: [
            [1, 1, 1],
            [2, 0.1, 0.6],
        ],
    },
    marimba: {
        attack: 0.002,
        partials: [
            [1, 1, 1],
            [4, 0.28, 0.18],
            [9.9, 0.06, 0.08],
        ],
    },
};

const trill = (start: number) =>
    [88, 83, 88, 83].map((pitch, index) => ({
        at: start + index * 0.11,
        pitch,
        decay: 0.28,
        level: 0.95,
    }));

export const sounds: Record<SoundName, Sound> = {
    message: {
        label: 'Direct message',
        when: 'A direct message arrives, or a message in a channel you follow for all messages.',
        group: 'Messages',
        timbre: 'marimba',
        notes: [
            { at: 0, pitch: 84, decay: 0.5, level: 0.9 },
            { at: 0.09, pitch: 88, decay: 0.65, level: 1 },
        ],
    },
    mention: {
        label: 'Mention',
        when: 'Someone @mentions you or replies in a thread you are part of.',
        group: 'Messages',
        timbre: 'bell',
        notes: [
            { at: 0, pitch: 84, decay: 0.4, level: 0.7 },
            { at: 0.075, pitch: 88, decay: 0.4, level: 0.75 },
            { at: 0.15, pitch: 91, decay: 0.75, level: 0.95 },
        ],
    },
    incomingCall: {
        label: 'Incoming call',
        when: 'Someone calls you. Rings until you join or decline, for up to 45 seconds.',
        group: 'Calls',
        timbre: 'kalimba',
        notes: [...trill(0), ...trill(0.62)],
        loop: 2.6,
    },
    outgoingCall: {
        label: 'Calling',
        when: 'You call someone and are waiting for them to join.',
        group: 'Calls',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 76, decay: 0.5, level: 0.5 },
            { at: 0.4, pitch: 76, decay: 0.5, level: 0.5 },
        ],
        loop: 3,
    },
    callDeclined: {
        label: 'Call declined',
        when: 'The person you called declines, or the call ends before anyone joins.',
        group: 'Calls',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 76, decay: 0.3, level: 0.6 },
            { at: 0.16, pitch: 71, decay: 0.55, level: 0.55 },
        ],
    },
    callJoined: {
        label: 'You joined',
        when: 'You connect to a voice channel or call.',
        group: 'Voice',
        timbre: 'kalimba',
        notes: [
            { at: 0, pitch: 72, decay: 0.3, level: 0.55 },
            { at: 0.07, pitch: 76, decay: 0.3, level: 0.6 },
            { at: 0.14, pitch: 79, decay: 0.5, level: 0.7 },
        ],
    },
    callLeft: {
        label: 'You left',
        when: 'You leave a voice channel or call, or are disconnected from it.',
        group: 'Voice',
        timbre: 'kalimba',
        notes: [
            { at: 0, pitch: 79, decay: 0.3, level: 0.6 },
            { at: 0.07, pitch: 76, decay: 0.3, level: 0.55 },
            { at: 0.14, pitch: 72, decay: 0.5, level: 0.55 },
        ],
    },
    memberJoined: {
        label: 'Someone joined',
        when: 'Someone joins the voice channel or call you are in.',
        group: 'Voice',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 74, decay: 0.3, level: 0.5 },
            { at: 0.09, pitch: 81, decay: 0.4, level: 0.55 },
        ],
    },
    memberLeft: {
        label: 'Someone left',
        when: 'Someone leaves the voice channel or call you are in.',
        group: 'Voice',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 81, decay: 0.3, level: 0.5 },
            { at: 0.09, pitch: 74, decay: 0.4, level: 0.45 },
        ],
    },
    mute: {
        label: 'Mute',
        when: 'You mute your microphone.',
        group: 'Your controls',
        timbre: 'soft',
        notes: [{ at: 0, pitch: 79, decay: 0.24, level: 1, glide: 0.84 }],
    },
    unmute: {
        label: 'Unmute',
        when: 'You unmute your microphone.',
        group: 'Your controls',
        timbre: 'soft',
        notes: [{ at: 0, pitch: 76, decay: 0.24, level: 1, glide: 1.19 }],
    },
    deafen: {
        label: 'Deafen',
        when: 'You turn off call audio.',
        group: 'Your controls',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 79, decay: 0.14, level: 0.5 },
            { at: 0.06, pitch: 74, decay: 0.2, level: 0.45 },
        ],
    },
    undeafen: {
        label: 'Undeafen',
        when: 'You turn call audio back on.',
        group: 'Your controls',
        timbre: 'soft',
        notes: [
            { at: 0, pitch: 74, decay: 0.14, level: 0.45 },
            { at: 0.06, pitch: 79, decay: 0.2, level: 0.5 },
        ],
    },
    shareStarted: {
        label: 'Screen share started',
        when: 'Someone in your call starts sharing their screen.',
        group: 'Screen sharing',
        timbre: 'bell',
        notes: [
            { at: 0, pitch: 86, decay: 0.3, level: 0.5 },
            { at: 0.06, pitch: 93, decay: 0.45, level: 0.55 },
        ],
    },
    shareStopped: {
        label: 'Screen share ended',
        when: 'A screen share in your call ends.',
        group: 'Screen sharing',
        timbre: 'bell',
        notes: [
            { at: 0, pitch: 93, decay: 0.3, level: 0.5 },
            { at: 0.06, pitch: 86, decay: 0.45, level: 0.45 },
        ],
    },
};

export const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

// Length of one play, including the echo tail.
export const soundLength = (name: SoundName) =>
    Math.max(...sounds[name].notes.map((note) => note.at + note.decay)) + 0.4;

// Schedules one play of a sound into output at the given volume (0–1) and returns
// its length in seconds. Nodes disconnect themselves once the sound has faded.
export function playSound(
    context: BaseAudioContext,
    output: AudioNode,
    name: SoundName,
    volume = 1,
    start = context.currentTime,
) {
    const sound = sounds[name];
    const timbre = timbres[sound.timbre];
    const nodes: AudioNode[] = [];
    const node = <T extends AudioNode>(created: T) => (nodes.push(created), created);
    const compressor = node(context.createDynamicsCompressor());
    compressor.threshold.value = -12;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    compressor.connect(output);
    const bus = node(context.createGain());
    bus.gain.value = 0.42 * Math.max(0, Math.min(1, volume));
    bus.connect(compressor);
    // A short, dark echo gives the tones a little room.
    const delay = node(context.createDelay(1));
    delay.delayTime.value = 0.13;
    const feedback = node(context.createGain());
    feedback.gain.value = 0.22;
    const tone = node(context.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const wet = node(context.createGain());
    wet.gain.value = 0.16;
    bus.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(wet);
    wet.connect(compressor);
    const nyquist = context.sampleRate / 2;
    for (const note of sound.notes) {
        const at = start + note.at;
        for (const [ratio, level, decay] of timbre.partials) {
            const pitch = frequency(note.pitch) * ratio;
            if (pitch >= nyquist * 0.9) continue;
            const oscillator = node(context.createOscillator());
            const envelope = node(context.createGain());
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(pitch, at);
            if (note.glide)
                oscillator.frequency.exponentialRampToValueAtTime(
                    pitch * note.glide,
                    at + note.decay * 0.6,
                );
            const end = at + timbre.attack + note.decay * decay;
            envelope.gain.setValueAtTime(0, at);
            envelope.gain.linearRampToValueAtTime(note.level * level, at + timbre.attack);
            envelope.gain.exponentialRampToValueAtTime(0.0001, end);
            oscillator.connect(envelope);
            envelope.connect(bus);
            oscillator.start(at);
            oscillator.stop(end + 0.02);
        }
    }
    const length = soundLength(name);
    setTimeout(
        () => nodes.forEach((created) => created.disconnect()),
        (start - context.currentTime + length + 1) * 1000,
    );
    return length;
}
