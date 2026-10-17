import type { DisplayStatus } from './presence';
import { statusLabels } from './presence';

export function PresenceDot({ status }: { status: DisplayStatus }) {
    return (
        <i
            className={`presence-dot ${status}-dot`}
            role="img"
            aria-label={statusLabels[status]}
            title={statusLabels[status]}
        />
    );
}
