/**
 * AsyncQueue - Zero-dependency async queue for serializing operations.
 *
 * Ensures tasks execute sequentially with optional timeout support.
 * Used by Lanes to prevent race conditions when rapidly creating sessions.
 */

/**
 * A queued task wrapper that resolves/rejects the original promise.
 */
interface QueuedTask {
    execute: () => Promise<void>;
}

/**
 * AsyncQueue provides sequential execution of async tasks with timeout support.
 *
 * Key features:
 * - Tasks execute in order (FIFO)
 * - Optional timeout per task (default 30s)
 * - One task failure doesn't stop queue processing
 * - Zero dependencies
 *
 * @example
 * ```typescript
 * const queue = new AsyncQueue();
 * await queue.add(async () => {
 *     await someAsyncOperation();
 * }, 5000); // 5 second timeout
 * ```
 */
export class AsyncQueue {
    private queue: Array<QueuedTask> = [];
    private processing = false;

    /**
     * Add a task to the queue and wait for its execution.
     *
     * @param task - Async function to execute
     * @param timeoutMs - Timeout in milliseconds (default: 30000)
     * @returns Promise that resolves with task result or rejects on error/timeout
     */
    async add<T>(task: () => Promise<T>, timeoutMs = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            const wrappedTask: QueuedTask = {
                execute: async () => {
                    try {
                        // Race the task against the timeout
                        const result = await Promise.race([
                            task(),
                            this.createTimeout(timeoutMs)
                        ]);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                }
            };

            this.queue.push(wrappedTask);
            this.process();
        });
    }

    /**
     * Create a timeout promise that rejects after the specified duration.
     */
    private createTimeout(timeoutMs: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }

    /**
     * Process the queue sequentially.
     * Only one process() runs at a time; if already processing, new calls are ignored.
     */
    private async process(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift()!;
                try {
                    await task.execute();
                } catch (err) {
                    // Log error but continue processing next task
                    console.error('AsyncQueue task failed:', err);
                }
            }
        } finally {
            this.processing = false;
        }
    }
}
