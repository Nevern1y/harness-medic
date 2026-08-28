import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(process.cwd(), '.harness-medic-child.pid'), String(child.pid), 'utf8');
const server = new McpServer({ name: 'harness-medic-child', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('read_child', { description: 'Reads synthetic fixture data only.' }, async () => ({ content: [{ type: 'text', text: 'synthetic fixture' }] }));
await server.connect(new StdioServerTransport());
