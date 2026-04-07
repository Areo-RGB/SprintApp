/**
 * adapters/vscode-copilot/hooks — VS Code Copilot hook definitions and matchers.
 *
 * Defines the hook types, matchers, and registration format specific to
 * VS Code Copilot's hook system. This module is used by:
 *   - CLI setup/upgrade commands (to configure hooks)
 *   - Doctor command (to validate hook configuration)
 *   - Hook config generation
 *
 * VS Code Copilot hook system reference:
 *   - Hooks are registered in .github/hooks/*.json
 *   - Hook names: PreToolUse, PostToolUse, PreCompact, SessionStart (PascalCase)
 *   - Additional hooks: Stop, SubagentStart, SubagentStop (unique to VS Code)
 *   - CRITICAL: matchers are parsed but IGNORED (all hooks fire on all tools)
 *   - Input: JSON on stdin
 *   - Output: JSON on stdout (or empty for passthrough)
 *   - Preview status — API may change
 */
/** VS Code Copilot hook types. */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "PreToolUse";
    readonly POST_TOOL_USE: "PostToolUse";
    readonly PRE_COMPACT: "PreCompact";
    readonly SESSION_START: "SessionStart";
    readonly STOP: "Stop";
    readonly SUBAGENT_START: "SubagentStart";
    readonly SUBAGENT_STOP: "SubagentStop";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/** Map of hook types to their script file names. */
export declare const HOOK_SCRIPTS: Record<string, string>;
/** Required hooks that must be configured for context-mode to function. */
export declare const REQUIRED_HOOKS: HookType[];
/** Optional hooks that enhance functionality but aren't critical. */
export declare const OPTIONAL_HOOKS: HookType[];
/**
 * Check if a hook entry points to a context-mode hook script.
 * Matches both legacy format (node .../pretooluse.mjs) and
 * CLI dispatcher format (context-mode hook vscode-copilot pretooluse).
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
