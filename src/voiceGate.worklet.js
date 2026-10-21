// Runs on the audio rendering thread so gating continues while the window is hidden.
class VoiceGate extends AudioWorkletProcessor {
    constructor() {
        super();
        this.enabled = false;
        this.threshold = -45;
        this.envelope = 1;
        this.hold = 0;
        this.open = false;
        this.port.onmessage = ({ data }) => {
            this.enabled = !!data.enabled;
            this.threshold = data.threshold;
        };
    }
    process(inputs, outputs) {
        const input = inputs[0],
            output = outputs[0];
        if (!input?.length || !output?.length) return true;
        let energy = 0,
            count = 0;
        for (const channel of input) {
            for (const sample of channel) energy += sample * sample;
            count += channel.length;
        }
        const db = 20 * Math.log10(Math.sqrt(energy / Math.max(1, count)) || 1e-12);
        const detected = db >= this.threshold - (this.open ? 3 : 0);
        if (detected) this.hold = Math.round(sampleRate * 0.2);
        this.open = detected || this.hold > 0;
        const target = !this.enabled || this.open ? 1 : 0;
        const coefficient = 1 - Math.exp(-1 / (sampleRate * (target ? 0.005 : 0.08)));
        for (let i = 0; i < output[0].length; i++) {
            this.envelope += (target - this.envelope) * coefficient;
            for (let channel = 0; channel < output.length; channel++)
                output[channel][i] = (input[channel]?.[i] || 0) * this.envelope;
        }
        this.hold = Math.max(0, this.hold - output[0].length);
        return true;
    }
}
registerProcessor('campfire-voice-gate', VoiceGate);
