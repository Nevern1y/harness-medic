# Rule reference

Rule IDs are machine-readable contracts. A finding's `evidenceClass`, confidence, and precision status qualify what the rule can claim; a heuristic match is a risk indicator, not proof of compromise or model behavior.

| ID | Doctor | Evidence | Default severity | Scoreable | Contract |
|---|---|---|---|---:|---|
| CTX001 | context | static | info | no | Reports observed active instruction bytes and token estimates. |
| CTX002 | context | static | info | no | Reports observed static MCP tool inventory cost. |
| CTX003 | context | static | warning | yes | Reports repeated active instruction clauses. |
| CTX004 | context | heuristic | info | no | Identifies likely context-heavy instruction sections. |
| CTX005 | context | static | info | no | Reports known managed or runtime coverage gaps. |
| CTX006 | context | static | info | no | Reports an explicitly observed provider context limit. |
| RULE001 | rules | static | error | yes | Reports invalid or unavailable instruction sources. |
| RULE002 | rules | static | warning | yes | Reports instructions shadowed by higher-precedence sources. |
| RULE003 | rules | static | warning | no | Reports concrete references that cannot be resolved. |
| RULE004 | rules | static | warning | no | Reports referenced commands or scripts not found in the fixture workspace. |
| RULE005 | rules | heuristic | error | no | Reports opposite-polarity clauses in overlapping scopes. |
| RULE006 | rules | static | warning | yes | Reports same-polarity duplicate clauses. |
| RULE007 | rules | heuristic | info | no | Reports vague guidance with low-confidence wording. |
| RULE008 | rules | static | warning | no | Reports instruction documents above the configured size threshold. |
| RULE009 | rules | behavioral | warning | no | Reports an explicitly recorded benchmark adherence result. |
| MCP001 | mcp | static | warning | yes | Reports duplicate MCP targets under different configured names. |
| MCP002 | mcp | static | error | yes | Reports same-name MCP registrations with different targets. |
| MCP003 | mcp | static | error | yes | Reports duplicate exposed tool names with differing metadata. |
| MCP004 | mcp | heuristic | info | no | Reports overlapping normalized tool names as a routing-risk indicator. |
| MCP005 | mcp | static | error | yes | Reports an explicit tool inventory that exceeds its known provider limit. |
| MCP006 | mcp | static | warning | yes | Reports an explicit tool inventory near its known provider limit. |
| MCP007 | mcp | static | error | yes | Reports an MCP command whose executable cannot be resolved. |
| MCP008 | mcp | static | error | yes | Reports active MCP servers that reference unavailable environment keys. |
| MCP009 | mcp | runtime | warning | no | Reports an observed MCP startup failure. |
| MCP010 | mcp | runtime | warning | no | Reports an observed MCP probe slower than the responsiveness threshold. |
| MCP011 | mcp | runtime | warning | no | Reports an observed tools/list failure after startup. |
| MCP012 | mcp | runtime | info | no | Reports a probe that needed a bounded retry. |
| MCP013 | mcp | runtime | warning | no | Reports observed tool metadata that changed from its baseline. |
| MCP014 | mcp | static | info | no | Reports disabled or shadowed MCP registrations. |
| HOOK001 | hooks | static | error | yes | Reports an invalid hook event. |
| HOOK002 | hooks | static | error | yes | Reports an invalid hook matcher. |
| HOOK003 | hooks | static | warning | yes | Reports a broad or missing matcher where the harness expects one. |
| HOOK004 | hooks | static | error | yes | Reports an unresolved hook command target. |
| HOOK005 | hooks | static | warning | no | Reports a hook target whose path differs from the expected workspace path. |
| HOOK006 | hooks | static | warning | no | Reports an unresolved interpreter on POSIX systems. |
| HOOK007 | hooks | static | warning | yes | Reports a command hook without an explicit timeout. |
| HOOK008 | hooks | heuristic | warning | no | Reports fail-open shell constructs in hook commands. |
| HOOK009 | hooks | heuristic | warning | no | Reports interactive input in a noninteractive hook command. |
| HOOK010 | hooks | runtime | info | no | Reports that an approved synthetic hook firing was unsupported or not observed. |
| HOOK011 | hooks | runtime | warning | no | Reports an observed hook runtime failure. |
| HOOK012 | hooks | runtime | warning | no | Reports an observed hook runtime timeout. |
| SEC001 | security | heuristic | warning | no | Reports metadata resembling instruction override or sensitive disclosure. |
| SEC002 | security | heuristic | warning | no | Reports same-name capabilities across trust boundaries. |
| SEC003 | security | static | warning | yes | Reports destructive capability words in tool metadata. |
| SEC004 | security | static | warning | no | Reports sensitive MCP parameter names. |
| SEC005 | security | static | warning | yes | Reports filesystem-sensitive capability names. |
| SEC006 | security | static | warning | yes | Reports shell or command execution capability names. |
| SEC007 | security | static | warning | yes | Reports non-managed remote MCP transports. |
| SEC008 | security | static | warning | yes | Reports unpinned package launcher arguments. |
| SEC009 | security | static | critical | yes | Reports destructive tools combined with broad auto-approval. |
| SEC010 | security | heuristic | warning | no | Reports hook commands resembling credential exfiltration. |
| SEC011 | security | static | critical | yes | Reports parser evidence of a plaintext secret. |
| SEC012 | security | runtime | warning | no | Reports previously approved MCP metadata or target identity drift from a local baseline. |

Use `harness-medic explain RULE_ID` for the live references and scoreability metadata. Rule implementations and references are the source of truth; this page is release-validated against the registry.
