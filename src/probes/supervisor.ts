export interface RetryEvent {
  attempt: number;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  transient: boolean;
  errorCode?: string;
}

export interface RetryResult<T> {
  value?: T;
  events: RetryEvent[];
  error?: unknown;
  timedOut: boolean;
}

export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  const { promise: timeoutPromise, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(Object.assign(new Error(`operation timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' })), timeoutMs);
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export async function retryBounded<T>(operation: (attempt: number) => Promise<T>, retries: number, timeoutMs: number, isTransient: (error: unknown) => boolean, onTimeout?: () => void, signal?: AbortSignal): Promise<RetryResult<T>> {
  const events: RetryEvent[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const started = Date.now();
    try {
      const value = await withTimeout(() => operation(attempt), timeoutMs);
      events.push({ attempt, startedAt: new Date(started).toISOString(), durationMs: Math.max(0, Date.now() - started), ok: true, transient: false });
      return { value, events, timedOut: false };
    } catch (error) {
      lastError = error;
      const timedOut = error instanceof Error && (error as Error & { code?: string }).code === 'TIMEOUT';
      if (timedOut) onTimeout?.();
      const transient = timedOut || isTransient(error);
      const errorCode = error instanceof Error ? ((error as Error & { code?: string }).code ?? error.name) : undefined;
      events.push({ attempt, startedAt: new Date(started).toISOString(), durationMs: Math.max(0, Date.now() - started), ok: false, transient, ...(errorCode ? { errorCode } : {}) });
      if (signal?.aborted) return { events, error, timedOut };
      if (!transient || attempt > retries) return { events, error, timedOut };
    }
  }
  return { events, error: lastError, timedOut: false };
}

export function isTransientProbeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:ECONNRESET|ECONNREFUSED|EPIPE|temporar|timeout|timed out|connection closed|503|502|429|disconnected)/i.test(message);
}
