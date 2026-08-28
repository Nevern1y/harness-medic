import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const marker = path.join(process.cwd(), '.harness-medic-transient-seen');
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'seen', 'utf8');
  process.stderr.write('temporary fixture failure\n');
  process.exit(75);
}
const server = new McpServer({ name: 'harness-medic-transient', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('read_transient', { description: 'Reads synthetic fixture data only.' }, async () => ({ content: [{ type: 'text', text: 'synthetic fixture' }] }));
await server.connect(new StdioServerTransport());
