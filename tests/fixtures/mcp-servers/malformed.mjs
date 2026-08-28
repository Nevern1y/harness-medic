let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'harness-medic-malformed', version: '1.0.0' } } })}\n`);
    } else if (message.method === 'tools/list') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{}] } })}\n`);
    }
  }
});
