export function VolumeControl({
    name,
    label,
    value,
    onChange,
    disabled = false,
}: {
    name: string;
    label: 'Voice' | 'Stream';
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    return (
        <label>
            {label}
            <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={value}
                disabled={disabled}
                aria-label={`${label} volume for ${name}`}
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </label>
    );
}
