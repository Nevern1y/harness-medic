import type { McpServer } from '../model.js';

export interface McpRuntimeConfig {
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  environment: Record<string, string>;
  headers: Record<string, string>;
}

const runtimeConfigurations = new WeakMap<McpServer, McpRuntimeConfig>();

export function setMcpRuntimeConfig(server: McpServer, config: McpRuntimeConfig): void {
  if (config.command || config.url || config.args.length > 0 || Object.keys(config.environment).length > 0 || Object.keys(config.headers).length > 0) runtimeConfigurations.set(server, { command: config.command, args: [...config.args], cwd: config.cwd, url: config.url, environment: { ...config.environment }, headers: { ...config.headers } });
}

export function getMcpRuntimeConfig(server: McpServer): McpRuntimeConfig {
  const config = runtimeConfigurations.get(server);
  return { command: config?.command, args: [...(config?.args ?? [])], cwd: config?.cwd, url: config?.url, environment: { ...(config?.environment ?? {}) }, headers: { ...(config?.headers ?? {}) } };
}
