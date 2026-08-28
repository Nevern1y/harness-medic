import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

if (process.env.FIXTURE_SECRET !== 'CANARY_SECRET') {
  process.stderr.write('fixture environment missing\n');
  process.exit(1);
}

const server = new McpServer({ name: 'harness-medic-env-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('read_fixture_env', { description: 'Reads synthetic environment fixture data only.' }, async () => ({
  content: [{ type: 'text', text: 'synthetic fixture' }],
}));
await server.connect(new StdioServerTransport());
