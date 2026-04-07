/**
 * lifecycle — Process lifecycle guard for MCP server.
 *
 * Detects parent process death, stdin close, and OS signals to prevent
 * orphaned MCP server processes consuming 100% CPU (issue #103).
 *
 * Cross-platform: macOS, Linux, Windows.
 */
export interface LifecycleGuardOptions {
    /** Interval in ms to check parent liveness. Default: 30_000 */
    checkIntervalMs?: number;
    /** Called when parent death or stdin close is detected. */
    onShutdown: () => void;
    /** Injectable parent-alive check (for testing). Default: ppid-based check. */
    isParentAlive?: () => boolean;
}
/**
 * Start the lifecycle guard. Returns a cleanup function.
 * Skipped automatically when stdin is a TTY (e.g. OpenCode ts-plugin).
 */
export declare function startLifecycleGuard(opts: LifecycleGuardOptions): () => void;
