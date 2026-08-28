import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'harness-medic-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('read_fixture', { description: 'Reads synthetic fixture data only.' }, async () => ({
  content: [{ type: 'text', text: 'synthetic fixture' }],
}));
await server.connect(new StdioServerTransport());
