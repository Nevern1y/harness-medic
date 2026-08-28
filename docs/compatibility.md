# Compatibility matrix

Harness Medic supports static configuration reconstruction for the four MVP adapters below. “Modeled” means the adapter has an explicit source and precedence contract; it does not mean every runtime-owned component is visible.

| Harness | Adapter contract | Sources modeled | Instructions | MCP | Hooks | Active probe | Behavior |
|---|---|---|---|---|---|---|---|
| Claude Code | `claude-code-adapter/0.1` | user/project/local/managed settings, user/project MCP files | `CLAUDE.md` and nested `.claude/CLAUDE.md` | JSON/JSONC-style `mcpServers` | static event, matcher, target, timeout checks | MCP startup/tools/list when approved; hook safe-sandbox status only | not observed by Tier 0 |
| Codex | `codex-adapter/0.1` | user/project/local TOML settings | ancestor and user `AGENTS.md` | TOML `mcp_servers` | static normalized hook shape | MCP startup/tools/list when approved; hook safe-sandbox status only | not observed by Tier 0 |
| OpenCode | `opencode-adapter/0.1` | user/project/local JSON/JSONC settings | ancestor memory plus `.opencode/rules` | `mcp` local/remote registrations | static normalized hook shape | MCP startup/tools/list when approved; hook safe-sandbox status only | not observed by Tier 0 |
| Cursor | `cursor-adapter/0.1` | user/project MCP JSON | ancestor and `.cursor/rules` | JSON `mcpServers` | static normalized hook shape where present | MCP startup/tools/list when approved; hook safe-sandbox status only | not observed by Tier 0 |

All adapters preserve parsed, invalid, unavailable, shadowed, and unknown evidence where it can be discovered. Managed policy, plugins, system prompts, runtime injection, and session state can remain coverage gaps. Exact support depends on the installed harness format; rerun fixtures when a harness changes its schema.

## Platform contract

CI exercises Windows, macOS, and Linux. Discovery and fixes preserve spaces, non-ASCII paths, CRLF, BOMs, PATHEXT resolution, symlink provenance, and platform path case rules. Active probes use the host process supervisor and are never part of the default scan.

## Evidence dimensions

Reports expose `detected`, `parsed`, `precedenceModeled`, `runtimeProbed`, and `behaviorObserved` separately for each adapter. A `static` result must not be interpreted as runtime or behavioral evidence.
