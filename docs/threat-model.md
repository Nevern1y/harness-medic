# Threat model

Harness Medic treats local harness configuration, MCP metadata, tool schemas, hooks, and transcripts as untrusted inputs. The scanner itself is a local diagnostic process, not a sandbox for arbitrary configuration.

## Protected assets

- credentials and environment values;
- source paths and instruction content;
- agent approval boundaries;
- filesystem, shell, network, and deletion capabilities;
- integrity of files changed by an autofix.

## Threats and controls

| Threat | Control |
|---|---|
| Secret leakage through report text or errors | structural recursive redaction before serialization; canary tests |
| Tool poisoning or suspicious metadata | untrusted metadata classification, matched evidence, confidence and precision status |
| Accidental MCP or hook execution | Tier 0 zero-execution boundary; explicit probe flag and consent |
| Remote server exposure | explicit network consent and remote transport finding |
| Unpinned package launch | static package-runner/version check |
| Capability plus auto-approval escalation | independent capability and permission checks with combination finding |
| Same-name or duplicate server confusion | canonical identity, collision, and effective inventory checks |
| Unsafe file mutation | compare-and-swap hashes, backups, postchecks, whole-plan rollback |
| False behavioral certainty | runtime and benchmark evidence classes remain separate from static findings |

A metadata match is not proof of maliciousness. It becomes actionable only with its source, matched span, trust preconditions, and confidence. Harness Medic is not malware detection, endpoint protection, or a replacement for specialist security scanners.

## Non-goals

The default scan does not execute a configured command, replay a hook, call a remote URL, upload data, or infer compromise from suspicious prose. Unknown provider limits and unobserved runtime components stay unknown.
