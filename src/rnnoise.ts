import { loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import workletUrl from './rnnoise.worklet.js?url&no-inline';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url&no-inline';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url&no-inline';

let binary: Promise<WebAssembly.Module> | undefined;
const modules = new WeakMap<AudioContext, Promise<void>>();

export async function createRnnoise(context: AudioContext) {
    if (context.sampleRate !== 48000) throw new Error('RNNoise requires 48 kHz audio.');
    binary ??= loadRnnoise({ url: wasmUrl, simdUrl })
        .then((buffer) => {
            // Surface failed downloads/CSP/invalid WASM before connecting a silent worklet.
            return WebAssembly.compile(buffer);
        })
        .catch((error) => {
            binary = undefined;
            throw new Error('RNNoise could not load. Retry or select Chromium.', { cause: error });
        });
    let module = modules.get(context);
    if (!module) {
        module = context.audioWorklet.addModule(workletUrl).catch((error) => {
            modules.delete(context);
            throw error;
        });
        modules.set(context, module);
    }
    const [wasmModule] = await Promise.all([binary, module]);
    // Capture is speech, so downmix to mono before RNNoise's 480-sample frames.
    const node = new AudioWorkletNode(context, 'campfire/rnnoise', {
        processorOptions: { wasmModule },
        numberOfOutputs: 2,
        outputChannelCount: [1, 1],
        channelCount: 1,
        channelCountMode: 'explicit',
    });
    let probability: number | null = null;
    let updated = 0;
    node.port.onmessage = ({ data }) => {
        if (typeof data?.speechProbability !== 'number' || !Number.isFinite(data.speechProbability))
            return;
        probability = Math.max(0, Math.min(1, data.speechProbability));
        updated = performance.now();
    };
    const destroy = () => {
        probability = null;
        node.port.postMessage('destroy');
        node.port.close();
    };
    return Object.assign(node, {
        destroy,
        speechProbability: () => (performance.now() - updated <= 500 ? probability : null),
    });
}
