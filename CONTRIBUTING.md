# Contributing to Harness Medic

Harness Medic is a local-first diagnostic CLI for coding-agent configuration. Contributions should preserve evidence boundaries, platform support, and the default no-execution path.

## Set up the repository

Use Node.js 24 or newer. Install the locked dependency set, then build the CLI:

```sh
npm ci
npm run build
node dist/cli/index.mjs --help
```

The repository uses TypeScript, native ECMAScript modules, npm, Vitest, ESLint, and tsdown. Keep the lockfile in sync with dependency changes.

## Run the verification gate

Run the checks that match your change. Run the full gate before opening a pull request:

```sh
npm run typecheck
npm test
npm run lint
npm run build
npm run pack:check
npm run test:security
npm run corpus:report
npm run benchmark:scan
npm run release:validate
```

A change is ready when its observable behavior is covered and the applicable checks pass. Do not weaken an assertion to make a fixture pass.

## Follow the project boundaries

- Keep the default scan read-only, offline, and free of configured command execution
- Preserve `static`, `runtime`, `behavioral`, and `heuristic` evidence classes
- Keep unknown, malformed, unavailable, and shadowed sources visible
- Redact secrets before constructing findings, reports, diagnostics, or snapshots
- Keep active probes consent-gated, bounded, cancellable, and limited to their declared protocol surface
- Make fixes previewable, hash-guarded, parser-aware, and rollback-safe
- Preserve Windows, macOS, and Linux behavior, including spaces and non-ASCII paths

The [threat model](docs/threat-model.md) and [privacy model](docs/privacy.md) define the security boundaries.

## Add a compatibility fixture

Fixtures are the compatibility contract. Use synthetic values, record the harness version and source scope, and pair positive behavior with an expected-negative case. Never commit credentials, private configuration, or a fixture that contacts a remote server.

Read [Contributing fixtures](docs/contributing-fixtures.md) before adding or changing a fixture. Update the adapter contract, compatibility matrix, and tests together when a harness format changes.

## Make a focused change

1. Search existing adapters, checks, parsers, and tests before adding a new pattern
2. Keep harness-specific precedence inside its adapter
3. Keep checks deterministic and independent from process-global state
4. Give new findings a stable rule ID, evidence contract, source location, confidence, impact, remediation, and fix safety
5. Add a regression test for each new observable behavior or failure mode
6. Update user-facing documentation when a command, rule, support dimension, or safety boundary changes

Avoid speculative abstractions, compatibility shims, placeholder implementations, and unrelated formatting changes.

## Open a pull request

Describe the behavior that changed, the reason for the change, and the exact verification commands you ran. Link the relevant issue or design decision when one exists. Include sanitized output for CLI changes and explain any intentional coverage gap.

Do not include real credentials, environment values, customer data, or unredacted harness reports in commits, issues, or pull requests.

## Report security issues privately

Do not disclose a vulnerability in a public issue. Follow the [security policy](SECURITY.md) for private reporting.

## Community standards

Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).
