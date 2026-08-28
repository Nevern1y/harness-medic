import { contextChecks } from './context/index.js';
import { rulesChecks } from './rules/index.js';
import { mcpChecks } from './mcp/index.js';
import { hookChecks } from './hooks/index.js';
import { securityChecks } from './security/index.js';
import type { CheckDefinition } from '../core/model.js';

export const allChecks: CheckDefinition[] = [...contextChecks, ...rulesChecks, ...mcpChecks, ...hookChecks, ...securityChecks].sort((left, right) => left.id.localeCompare(right.id));

export function checkById(ruleId: string): CheckDefinition | undefined {
  return allChecks.find((check) => check.id === ruleId);
}

export const ruleIds = allChecks.map((check) => check.id);
