---
date: 2026-11-09T17:16:00-06:00
git_commit: d988278b844715e8df9777d15c0b7ed31da28b23
branch: main
repository: meetingmind
topic: "Obsidian Agent (ACP Client) Plugin Architecture & Integration Analysis"
tags: [research, codebase, obsidian, acp, agent, goose]
status: complete
---

# Research: Obsidian Agent (ACP Client) Plugin Architecture & Integration Analysis

## Research Question
How does the `obsidian-agent` plugin (`/Users/dditch/Projects/dcode/obsidian-plugins/obsidian-agent`) implement the Agent Client Protocol (ACP) and interact with agent binaries (such as `goose acp`), and how can MeetingMind leverage or interact with it (or implement a similar ACP client approach)?

## Summary
The `obsidian-agent` plugin provides a robust implementation of the Agent Client Protocol (ACP) via `@agentclientprotocol/sdk`. It spawns a child process for the configured agent command (e.g., `goose acp`), establishes an NDJSON stream connection over stdin/stdout, initializes a session, and exposes methods for sending prompts, executing tool calls, and receiving session updates.

## Detailed Findings

### 1. ACP Client Architecture & Spawning (`acp-client.ts`)
- **Primary Location**: `/Users/dditch/Projects/dcode/obsidian-plugins/obsidian-agent/acp-client.ts`
- **Mechanism**: 
  - Uses `child_process.spawn` to launch the agent command (e.g., `goose` with args `acpt` or `acp`).
  - Bridges Node.js streams (`stdin`, `stdout`) to Web Streams (`WritableStream`, `ReadableStream`) for `@agentclientprotocol/sdk` (`ndJsonStream`).
  - Implements `ClientSideConnection` to handle client/agent RPC requests (including tool execution like reading/writing notes in the vault).
  - Handles session lifecycle (`initializeSession`, `prompt`, `cancel`).

### 2. Main Plugin Integration (`main.ts`)
- **Primary Location**: `/Users/dditch/Projects/dcode/obsidian-plugins/obsidian-agent/main.ts`
- **Responsibilities**: Registers commands, manages settings (agent command, args), and provides access to `ACPClient`.

### 3. Settings (`settings.ts`, `settings-tab.ts`)
- Configures `agentCommand` (defaulting to `goose` or similar) and `agentArgs` (defaulting to `acp`).

## Architecture & Data Flow

```
[Obsidian Plugin (MeetingMind or Obsidian-Agent)] 
       |
       v (ACPClient spawns process)
[Child Process: `goose acp`] <---> (NDJSON over Stdin/Stdout) <---> [Agent / LLM]
```

## Code References
- `/Users/dditch/Projects/dcode/obsidian-plugins/obsidian-agent/acp-client.ts:35-110` - Process spawning and stream bridging.
- `/Users/dditch/Projects/dcode/obsidian-plugins/obsidian-agent/acp-client.ts:111-200` - ACP connection initialization and session start.

## Established Patterns & Conventions
1. **Agent Client Protocol (ACP)**: Standardized JSON-RPC / NDJSON communication over stdio between an editor/client and an AI agent CLI.
2. **Child Process Spawning**: Utilizing `shell-env` to resolve user path binaries like `goose`.
