# Security policy

Harness Medic reads coding-agent configuration and can optionally start explicitly approved MCP fixture processes. Treat reports, source paths, and local configuration as sensitive.

## Supported versions

| Version | Security support |
|---|---|
| `0.1.x` | Supported for the current release line |
| `<0.1.0` | Not supported |

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Submit it through GitHub’s private vulnerability reporting flow from the repository’s **Security** tab. If private reporting is unavailable, contact the maintainers through a private channel listed on the repository profile before sharing details.

Include the following information:

- affected version or commit
- operating system, Node.js version, and harness version
- a minimal reproduction using synthetic values
- expected behavior, observed behavior, and security impact
- logs or reports with credentials, environment values, and private paths removed

Do not test against another person’s workspace, run destructive hooks, contact an untrusted MCP server, or include a real secret in a reproduction.

## Scope

The scanner is not a sandbox, malware detector, endpoint protection product, or replacement for a specialist security scanner. Security reports should focus on Harness Medic’s code, package, default execution boundary, redaction behavior, probe controls, fix transactions, and release artifacts.
