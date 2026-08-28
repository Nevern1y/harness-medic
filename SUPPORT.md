# Support

Use the repository templates so each report reaches the right review path.

- **CLI failure**: open a [bug report](.github/ISSUE_TEMPLATE/bug.yml) with a sanitized command, fixture shape, output, and environment
- **Harness format or regression case**: open a [compatibility fixture request](.github/ISSUE_TEMPLATE/fixture.yml)
- **Security concern**: follow the [security policy](SECURITY.md); do not use a public issue
- **Contribution question**: read [CONTRIBUTING.md](CONTRIBUTING.md) and [the fixture guide](docs/contributing-fixtures.md)

Before opening an issue, search existing issues and attach only redacted output. Remove credentials, environment values, private paths, and customer configuration.

For a first local check, run:

```sh
node dist/cli/index.mjs scan --no-interactive --fail-on never
```

If you are running from source, build first with `npm run build`.
