import { describe, expect, it } from 'vitest';
import { isTransientProbeError, retryBounded, withTimeout } from '../../src/probes/supervisor.js';

describe('probe supervisor', () => {
  it('retries transient failures and records attempts', async () => {
    let attempts = 0;
    const result = await retryBounded(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('ECONNRESET');
      return 'ok';
    }, 1, 100, isTransientProbeError);
    expect(result.value).toBe('ok');
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.transient).toBe(true);
  });

  it('bounds a hanging operation', async () => {
    await expect(withTimeout(() => new Promise<string>(() => undefined), 10)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
