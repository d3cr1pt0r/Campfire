// Coalesce bursts and serialize full-state requests. A refresh requested during
// an active fetch runs once afterward so an older snapshot cannot win.
export function createStateRefresh<T>(
    load: (signal: AbortSignal) => Promise<T>,
    receive: (value: T) => void,
    fail: (error: Error) => void,
) {
    let requested = false,
        generation = 0;
    let running: Promise<void> | null = null,
        controller: AbortController | null = null;
    return {
        refresh(): Promise<void> {
            requested = true;
            if (running) return running;
            const current = generation;
            running = Promise.resolve()
                .then(async () => {
                    while (requested && generation === current) {
                        requested = false;
                        controller = new AbortController();
                        try {
                            const value = await load(controller.signal);
                            if (generation === current && !requested) receive(value);
                        } catch (error) {
                            if (generation === current) {
                                requested = false;
                                fail(error as Error);
                            }
                        }
                    }
                })
                .finally(() => {
                    if (generation === current) {
                        running = null;
                        controller = null;
                    }
                });
            return running;
        },
        cancel() {
            generation++;
            requested = false;
            controller?.abort();
            controller = null;
            running = null;
        },
    };
}
