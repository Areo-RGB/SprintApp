/**
 * Session event extraction — pure functions, zero side effects.
 * Extracts structured events from Claude Code tool calls and user messages.
 *
 * All 13 event categories as specified in PRD Section 3.
 */
export interface SessionEvent {
    /** e.g. "file_read", "file_write", "cwd", "error_tool", "git", "task",
     *  "decision", "rule", "env", "role", "skill", "subagent", "data", "intent" */
    type: string;
    /** e.g. "file", "cwd", "error", "git", "task", "decision",
     *  "rule", "env", "role", "skill", "subagent", "data", "intent" */
    category: string;
    /** Extracted payload — full data, no truncation */
    data: string;
    /** 1=critical (rules, files, tasks) … 5=low */
    priority: number;
}
export interface ToolCall {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResponse?: string;
    isError?: boolean;
}
/**
 * Hook input shape as received from Claude Code PostToolUse hook stdin.
 * Uses snake_case to match the raw hook JSON.
 */
export interface HookInput {
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response?: string;
    /** Optional structured output from the tool (may carry isError) */
    tool_output?: {
        isError?: boolean;
    };
}
/**
 * Extract session events from a PostToolUse hook input.
 *
 * Accepts the raw hook JSON shape (snake_case keys) as received from stdin.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractEvents(input: HookInput): SessionEvent[];
/**
 * Extract session events from a UserPromptSubmit hook input (user message text).
 *
 * Handles: decision, role, intent, data categories.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractUserEvents(message: string): SessionEvent[];
