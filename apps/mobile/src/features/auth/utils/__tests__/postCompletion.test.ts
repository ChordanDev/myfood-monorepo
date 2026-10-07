import {
  decidePostCompletion,
  reconcileAfterCompletion,
  retryWithBackoff,
  type Delay,
} from '../postCompletion';

describe('decidePostCompletion (Judgment Day C2)', () => {
  it('keeps isComplete=false when the POST did not persist', () => {
    const decision = decidePostCompletion({
      wasComplete: false,
      persisted: false,
      refreshError: null,
    });
    expect(decision).toEqual({ isComplete: false, shouldRetryRefresh: false });
  });

  it('flips isComplete=true after a successful POST, even if refreshMe is still pending', () => {
    const decision = decidePostCompletion({
      wasComplete: false,
      persisted: true,
      refreshError: undefined,
    });
    expect(decision).toEqual({ isComplete: true, shouldRetryRefresh: false });
  });

  it('still flips isComplete=true after a successful POST when refreshMe failed (no hard error)', () => {
    const decision = decidePostCompletion({
      wasComplete: false,
      persisted: true,
      refreshError: new Error('offline'),
    });
    expect(decision.isComplete).toBe(true);
    expect(decision.shouldRetryRefresh).toBe(true);
  });

  it('keeps a previously-complete user complete even if refreshMe fails', () => {
    const decision = decidePostCompletion({
      wasComplete: true,
      persisted: true,
      refreshError: new Error('boom'),
    });
    expect(decision).toEqual({ isComplete: true, shouldRetryRefresh: true });
  });
});

describe('retryWithBackoff', () => {
  it('returns success on the first attempt without sleeping', async () => {
    const delay = jest.fn<Promise<void>, [number]>();
    const operation = jest.fn().mockResolvedValue('ok');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      delay,
    });

    expect(result).toEqual({ attempts: 1, outcome: 'success', value: 'ok' });
    expect(delay).not.toHaveBeenCalled();
  });

  it('retries with exponential backoff and returns success on attempt 2', async () => {
    const delays: number[] = [];
    const delay: Delay = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 100,
      delay,
    });

    expect(result.outcome).toBe('success');
    expect(result.attempts).toBe(2);
    expect(delays).toEqual([100]);
  });

  it('returns exhausted after maxAttempts and surfaces only the last error', async () => {
    const delays: number[] = [];
    const delay: Delay = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const operation = jest
      .fn<Promise<string>, []>()
      .mockImplementation(() => Promise.reject(new Error('still failing')));

    const result = await retryWithBackoff(operation, {
      maxAttempts: 3,
      baseDelayMs: 50,
      delay,
    });

    expect(result.outcome).toBe('exhausted');
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([50, 100]); // slept between attempts 1->2 and 2->3
    expect(result.value).toBeUndefined();
  });

  it('aborts when shouldRetry returns false (non-transient error)', async () => {
    const delays: number[] = [];
    const delay: Delay = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const operation = jest.fn().mockRejectedValue(new Error('fatal'));

    const result = await retryWithBackoff(operation, {
      maxAttempts: 5,
      baseDelayMs: 10,
      delay,
      shouldRetry: () => false,
    });

    expect(result.outcome).toBe('aborted');
    expect(result.attempts).toBe(1);
    expect(delays).toEqual([]);
  });
});

describe('reconcileAfterCompletion (Judgment Day C2 orchestration)', () => {
  it('does nothing when the POST did not persist', async () => {
    const onOptimistic = jest.fn();
    const onRefreshed = jest.fn();
    const refresh = jest.fn();

    const result = await reconcileAfterCompletion<string>({
      wasComplete: false,
      persisted: false,
      refresh,
      onOptimistic,
      onRefreshed,
      shouldRetry: () => true,
    });

    expect(result.outcome).toBe('no-persist');
    expect(result.refreshed).toBeNull();
    expect(onOptimistic).not.toHaveBeenCalled();
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('flips the optimistic flag immediately after a successful POST and applies the refreshed snapshot', async () => {
    const onOptimistic = jest.fn();
    const onRefreshed = jest.fn();
    const refresh = jest.fn().mockResolvedValue({ me: 'fresh' });

    const result = await reconcileAfterCompletion<{ me: string }>({
      wasComplete: false,
      persisted: true,
      refresh,
      onOptimistic,
      onRefreshed,
      shouldRetry: () => true,
      baseDelayMs: 1,
    });

    expect(result.outcome).toBe('refresh-success');
    expect(result.refreshed).toEqual({ me: 'fresh' });
    expect(onOptimistic).toHaveBeenCalledWith(true);
    expect(onRefreshed).toHaveBeenCalledWith({ me: 'fresh' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a transient refresh failure after the POST persisted and reports refresh-failed', async () => {
    const onOptimistic = jest.fn();
    const onRefreshed = jest.fn();
    const refresh = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));

    const result = await reconcileAfterCompletion<string>({
      wasComplete: false,
      persisted: true,
      refresh,
      onOptimistic,
      onRefreshed,
      shouldRetry: () => true,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    expect(result.outcome).toBe('refresh-failed');
    expect(result.refreshed).toBeNull();
    expect(onOptimistic).toHaveBeenCalledWith(true);
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('recovers when the refresh succeeds on the second attempt', async () => {
    const onOptimistic = jest.fn();
    const onRefreshed = jest.fn();
    const refresh = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ me: 'after-retry' });

    const result = await reconcileAfterCompletion<{ me: string }>({
      wasComplete: false,
      persisted: true,
      refresh,
      onOptimistic,
      onRefreshed,
      shouldRetry: () => true,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    expect(result.outcome).toBe('refresh-success');
    expect(onRefreshed).toHaveBeenCalledWith({ me: 'after-retry' });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('aborts retries on a non-transient error and reports refresh-failed', async () => {
    const onOptimistic = jest.fn();
    const onRefreshed = jest.fn();
    const refresh = jest.fn().mockRejectedValue(new Error('fatal'));

    const result = await reconcileAfterCompletion<string>({
      wasComplete: false,
      persisted: true,
      refresh,
      onOptimistic,
      onRefreshed,
      shouldRetry: () => false,
      maxAttempts: 5,
      baseDelayMs: 1,
    });

    expect(result.outcome).toBe('refresh-failed');
    expect(onOptimistic).toHaveBeenCalledWith(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
