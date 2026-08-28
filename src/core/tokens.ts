import { getEncoding } from 'js-tiktoken';
import type { TokenEstimate } from './model.js';

type SupportedEstimator = 'o200k_base' | 'cl100k_base';

const encoders = new Map<SupportedEstimator, ReturnType<typeof getEncoding>>();

function encoderFor(estimator: SupportedEstimator): ReturnType<typeof getEncoding> {
  const existing = encoders.get(estimator);
  if (existing) return existing;
  const encoder = getEncoding(estimator);
  encoders.set(estimator, encoder);
  return encoder;
}
export function estimateTokens(text: string, estimator: 'o200k_base' | 'cl100k_base' = 'o200k_base'): TokenEstimate {
  try {
    const encoder = encoderFor(estimator);
    const tokens = encoder.encode(text).length;
    return { estimator, tokens, exact: true };
  } catch {
    return { estimator: 'byte-fallback', tokens: Buffer.byteLength(text, 'utf8'), exact: false };
  }
}

export function estimateTokenSet(text: string): TokenEstimate[] {
  const primary = estimateTokens(text, 'o200k_base');
  const secondary = estimateTokens(text, 'cl100k_base');
  if (primary.estimator === secondary.estimator) return [primary];
  return [primary, secondary];
}
