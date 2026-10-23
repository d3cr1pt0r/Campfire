// RNNoise's C API, using the WASM binaries bundled by web-noise-suppressor.
// Output 0 is denoised mono audio; output 1 is its aligned speech probability.
class RnnoiseProcessor extends AudioWorkletProcessor {
    constructor({ processorOptions }) {
        super();
        let memory;
        const module =
            processorOptions.wasmModule ?? new WebAssembly.Module(processorOptions.wasmBinary);
        const instance = new WebAssembly.Instance(module, {
            env: {
                emscripten_memcpy_big: (destination, source, count) => {
                    new Uint8Array(memory.buffer).copyWithin(destination, source, source + count);
                    return destination;
                },
                emscripten_resize_heap: (bytes) => {
                    try {
                        memory.grow(
                            Math.max(0, Math.ceil((bytes - memory.buffer.byteLength) / 65536)),
                        );
                        return 1;
                    } catch {
                        return 0;
                    }
                },
                __assert_fail: () => {
                    throw new Error('RNNoise assertion failed.');
                },
            },
        });
        this.api = instance.exports;
        memory = this.api.memory;
        this.api.emscripten_stack_init();
        this.api.__wasm_call_ctors();
        if (this.api.rnnoise_get_frame_size() !== 480)
            throw new Error('Unexpected RNNoise frame size.');
        this.state = this.api.rnnoise_create(0);
        this.buffer = this.api.malloc(480 * 4);
        if (!this.state || !this.buffer) {
            this.destroy();
            throw new Error('RNNoise could not allocate audio buffers.');
        }
        this.frame = new Float32Array(480);
        this.heap = new Float32Array(memory.buffer, this.buffer, 480);
        this.audio = new Float32Array(1440);
        this.probabilities = new Float32Array(1440);
        this.inputPosition = 0;
        this.readPosition = 0;
        this.writePosition = 480;
        this.previewSamples = 0;
        this.destroyed = false;
        this.port.onmessage = ({ data }) => {
            if (data === 'destroy') this.destroy();
        };
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.state) this.api.rnnoise_destroy(this.state);
        if (this.buffer) this.api.free(this.buffer);
        this.port.close();
    }
    process(inputs, outputs) {
        if (this.destroyed) return false;
        const input = inputs[0]?.[0],
            output = outputs[0]?.[0],
            probability = outputs[1]?.[0];
        if (!output) return true;
        for (let i = 0; i < output.length; i++) {
            this.frame[this.inputPosition++] = (input?.[i] ?? 0) * 32767;
            if (this.inputPosition === 480) {
                const heap = this.heap;
                heap.set(this.frame);
                const speech = this.api.rnnoise_process_frame(this.state, this.buffer, this.buffer);
                for (let j = 0; j < 480; j++) {
                    this.audio[this.writePosition] = heap[j] / 32767;
                    this.probabilities[this.writePosition] = speech;
                    this.writePosition = (this.writePosition + 1) % this.audio.length;
                }
                this.inputPosition = 0;
            }
            output[i] = this.audio[this.readPosition];
            if (probability) probability[i] = this.probabilities[this.readPosition];
            this.readPosition = (this.readPosition + 1) % this.audio.length;
        }
        this.previewSamples += output.length;
        if (this.previewSamples >= 3840) {
            this.previewSamples = 0;
            this.port.postMessage({
                speechProbability:
                    this.probabilities[
                        (this.readPosition + this.audio.length - 1) % this.audio.length
                    ],
            });
        }
        return true;
    }
}
registerProcessor('campfire/rnnoise', RnnoiseProcessor);
