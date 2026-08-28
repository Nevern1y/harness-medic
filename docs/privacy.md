# Privacy model

## Default operation

Tier 0 reads selected configuration and instruction files under the workspace and harness home. It executes no configured MCP command or hook, opens no remote connection, and sends no telemetry. The report records zero network requests and zero child processes for this mode.

## Redaction boundary

Redaction happens before normalized objects, findings, reports, terminal strings, JSON snapshots, and error messages are built. Sensitive object keys include passwords, tokens, API keys, private keys, credentials, authorization, cookies, and environment values. Known token formats, bearer values, private-key blocks, and assignment values are replaced with `[REDACTED]`. Environment values are never copied to output; key names and one-way fingerprints are the maximum representation.

Instruction text and MCP metadata are untrusted input. Tool schemas are redacted recursively, and metadata pattern matches are reported as indicators rather than verdicts.

## Active probes

`mcp --probe` is opt-in. Non-interactive runs require `--allow-server`; remote transports additionally require `--allow-network`; third-party or unknown-trust transports additionally require `--allow-untrusted`. The preview contains a redacted command or URL. Probes call only initialization and `tools/list`, use bounded timeout/retry controls, and terminate child process trees. Declined or unsupported targets remain unobserved and are not scored as runtime failures. `hooks --probe` is also opt-in but currently records only an unsupported safe-sandbox observation; configured hook commands are never executed.

## Fixes and local artifacts

Fix plans contain content hashes, parser-aware operations, and affected paths. Transaction rollback bytes are kept local; the temporary journal is permission-restricted and removed after a successful commit. Baselines are local redacted snapshots. Users should review and delete local reports, baselines, and journals according to their own retention policy.

## Limits

A static scan cannot observe provider-owned system prompts, plugin injection, transcripts, or runtime behavior unless an explicit export or probe supplies them. Harness Medic therefore reports coverage gaps and never advertises a universal context total or behavioral guarantee.
