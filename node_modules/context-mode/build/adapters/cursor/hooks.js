/**
 * adapters/cursor/hooks — Cursor hook definitions and config helpers.
 *
 * Cursor native hook config lives in `.cursor/hooks.json` or `~/.cursor/hooks.json`.
 * Unlike Claude/Gemini/VS Code Copilot, each hook entry is a flat object rather
 * than a `{ matcher, hooks: [...] }` wrapper.
 */
/** Cursor hook type names. */
export const HOOK_TYPES = {
    PRE_TOOL_USE: "preToolUse",
    POST_TOOL_USE: "postToolUse",
    SESSION_START: "sessionStart",
    STOP: "stop",
    AFTER_AGENT_RESPONSE: "afterAgentResponse",
};
/** Map of hook types that have actual script files. */
export const HOOK_SCRIPTS = {
    [HOOK_TYPES.PRE_TOOL_USE]: "pretooluse.mjs",
    [HOOK_TYPES.POST_TOOL_USE]: "posttooluse.mjs",
    [HOOK_TYPES.SESSION_START]: "sessionstart.mjs",
    [HOOK_TYPES.STOP]: "stop.mjs",
};
/** Canonical Cursor-native matchers for tools context-mode routes proactively. */
export const PRE_TOOL_USE_MATCHERS = [
    "Shell",
    "Read",
    "Grep",
    "WebFetch",
    "mcp_web_fetch",
    "mcp_fetch_tool",
    "Task",
    "MCP:ctx_execute",
    "MCP:ctx_execute_file",
    "MCP:ctx_batch_execute",
];
export const PRE_TOOL_USE_MATCHER_PATTERN = PRE_TOOL_USE_MATCHERS.join("|");
/** Required hooks for native Cursor support. */
export const REQUIRED_HOOKS = [
    HOOK_TYPES.PRE_TOOL_USE,
];
/** Optional hooks that improve behavior but aren't strictly required. */
export const OPTIONAL_HOOKS = [HOOK_TYPES.POST_TOOL_USE];
/** Check whether a native Cursor hook entry points to context-mode. */
export function isContextModeHook(entry, hookType) {
    const scriptName = HOOK_SCRIPTS[hookType];
    const cliCommand = buildHookCommand(hookType);
    if ("command" in entry) {
        const cmd = entry.command ?? "";
        return (scriptName != null && cmd.includes(scriptName)) || cmd.includes(cliCommand);
    }
    const wrappedEntry = entry;
    return (wrappedEntry.hooks?.some((hook) => {
        const cmd = hook.command ?? "";
        return (scriptName != null && cmd.includes(scriptName)) || cmd.includes(cliCommand);
    }) ?? false);
}
/** Build the CLI dispatcher command for a Cursor hook type. */
export function buildHookCommand(hookType) {
    return `context-mode hook cursor ${hookType.toLowerCase()}`;
}
