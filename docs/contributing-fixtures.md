# Contributing fixtures

Fixtures are the compatibility contract. Each fixture must be synthetic, reproducible, and safe to execute only when a test explicitly opts in.

## Required contents

1. Keep paths relative to the fixture root; include a Windows-safe and POSIX-safe case when path behavior differs.
2. Use canary values such as `CANARY_SECRET`, never real credentials.
3. Pair positive security/conflict cases with an expected-negative benign case.
4. Record the harness format/version and source scope in the test name or fixture manifest.
5. Assert provenance, precedence, evidence class, redaction, and degraded behavior for malformed sources.
6. MCP servers must be deterministic fixture processes. They may implement initialization and `tools/list` only; no network or destructive action.

## Running checks

```sh
npm run test:fixtures
npm run test:integration
npm run test:security
npm run corpus:report
```

Do not weaken an assertion to accommodate a fixture. If a harness format changes, update the adapter contract, compatibility matrix, and both positive and negative coverage together.
