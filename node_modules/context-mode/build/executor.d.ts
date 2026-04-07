import { type RuntimeMap, type Language } from "./runtime.js";
export type { ExecResult } from "./types.js";
import type { ExecResult } from "./types.js";
interface ExecuteOptions {
    language: Language;
    code: string;
    timeout?: number;
    /** Keep process running after timeout instead of killing it. */
    background?: boolean;
}
interface ExecuteFileOptions extends ExecuteOptions {
    path: string;
}
export declare class PolyglotExecutor {
    #private;
    constructor(opts?: {
        hardCapBytes?: number;
        projectRoot?: string;
        runtimes?: RuntimeMap;
    });
    get runtimes(): RuntimeMap;
    /** Kill all backgrounded processes to prevent zombie/port-conflict issues. */
    cleanupBackgrounded(): void;
    execute(opts: ExecuteOptions): Promise<ExecResult>;
    executeFile(opts: ExecuteFileOptions): Promise<ExecResult>;
}
