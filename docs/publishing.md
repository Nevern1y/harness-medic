# Publish Harness Medic on GitHub

This guide prepares the repository for a public launch. GitHub search and topic pages can help people find a project, but no setting guarantees stars. Clear positioning, a reproducible first run, and useful releases create the evidence that earns them.

## Set the repository metadata

Use this description in the repository’s **About** panel:

> Local-first diagnostics for Claude Code, Codex, OpenCode, and Cursor configuration, MCP servers, hooks, and context overhead.

Add these lowercase topics. They describe the project’s purpose without keyword stuffing:

```text
coding-agents
developer-tools
developer-experience
configuration
mcp
claude-code
openai-codex
opencode
cursor
security
static-analysis
typescript
cli
privacy
```

GitHub topics use lowercase letters, numbers, and hyphens. GitHub allows up to 20 topics, so keep the list focused.

## Add the social preview

Upload `assets/brand/harness-medic-social-preview.png` in the repository’s **Settings → Social preview** section. The file is a 1280 × 640 PNG and stays below GitHub’s 1 MB recommendation.

Use a solid background. Check the preview in both light and dark social clients before saving it.

## Launch checklist

1. Make the repository public only after removing private paths, temporary reports, credentials, and unpublished material
2. Confirm `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` appear at the repository root
3. Review the README’s first paragraph, quick-start command, screenshot, support matrix, and safety boundary
4. Add the description, topics, and social preview from this guide
5. Create a release tag that matches `package.json`, then attach release notes with the verification result
6. Open one focused issue for the next useful fixture or adapter gap
7. Share the repository with a short problem statement and the reproducible command, not a generic launch announcement

## Keep the listing useful

- Keep the first README paragraph specific about the four supported harnesses and the no-network default
- Show a real scan result with sanitized paths and synthetic values
- Link to the compatibility, privacy, threat-model, and fixture documents
- Keep issue forms narrow so reports contain commands, environments, and reproducible evidence
- Publish changes through tagged releases and update the compatibility matrix when harness formats drift
- Do not claim universal context totals, malware detection, or runtime behavior from a static scan

GitHub documents the relevant repository surfaces in [About README files](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes), [repository topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics), and [social previews](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
