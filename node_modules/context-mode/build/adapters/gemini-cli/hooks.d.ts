/**
 * adapters/gemini-cli/hooks — Gemini CLI hook definitions and matchers.
 *
 * Defines the hook types, matchers, and registration format specific to
 * Gemini CLI's hook system. This module is used by:
 *   - CLI setup/upgrade commands (to configure hooks in settings.json)
 *   - Doctor command (to validate hook configuration)
 *   - Hook config generation
 *
 * Gemini CLI hook system reference:
 *   - Hooks are registered in ~/.gemini/settings.json under "hooks" key
 *   - Each hook type maps to an array of { matcher, hooks } entries
 *   - Hook names: BeforeTool, AfterTool, PreCompress, SessionStart
 *   - Input: JSON on stdin
 *   - Output: JSON on stdout (or empty for passthrough)
 */
/** Gemini CLI hook types. */
export declare const HOOK_TYPES: {
    readonly BEFORE_TOOL: "BeforeTool";
    readonly AFTER_TOOL: "AfterTool";
    readonly PRE_COMPRESS: "PreCompress";
    readonly SESSION_START: "SessionStart";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/** Map of hook types to their script file names. */
export declare const HOOK_SCRIPTS: Record<HookType, string>;
/** Required hooks that must be configured for context-mode to function. */
export declare const REQUIRED_HOOKS: HookType[];
/** Optional hooks that enhance functionality but aren't critical. */
export declare const OPTIONAL_HOOKS: HookType[];
/**
 * Check if a hook entry points to a context-mode hook script.
 * Matches both legacy format (node .../beforetool.mjs) and
 * CLI dispatcher format (context-mode hook gemini-cli beforetool).
 */
export declare function isContextModeHook(entry: {
    hooks?: Array<{
        command?: string;
    }>;
}, hookType: HookType): boolean;
/**
 * Build the hook command string for a given hook type.
 * Uses absolute node path to avoid PATH issues (homebrew, nvm, volta, etc.).
 * Falls back to CLI dispatcher if pluginRoot is not provided.
 */
export declare function buildHookCommand(hookType: HookType, pluginRoot?: string): string;
