## Summary

<!-- State the observable behavior and why it changes. -->

## Verification

<!-- List exact commands and relevant fixture or smoke scenarios. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] Applicable release, security, fixture, or package checks pass

## Safety and privacy

- [ ] No credentials, environment values, customer data, or unredacted reports are included
- [ ] Hooks and MCP servers were not executed unless the test explicitly requires a deterministic fixture
- [ ] Default no-network and no-configured-execution boundaries remain intact
- [ ] Documentation, rule references, compatibility metadata, and examples are updated when needed
