import {
  canSave,
  initialLoadState,
  loadFailed,
  loadSucceeded,
  saveFinished,
  startLoading,
  startSaving,
} from '../utils/profileLoadState';

describe('profileLoadState (Judgment Day S2 + S3)', () => {
  it('starts in idle and is not saveable', () => {
    expect(initialLoadState.status).toBe('idle');
    expect(canSave(initialLoadState)).toBe(false);
  });

  it('transitions idle -> loading -> ready when the GET succeeds', () => {
    const loading = startLoading(initialLoadState);
    expect(loading.status).toBe('loading');
    expect(canSave(loading)).toBe(false);

    const ready = loadSucceeded(loading);
    expect(ready.status).toBe('ready');
    expect(canSave(ready)).toBe(true);
  });

  it('transitions to error when the GET fails and blocks save', () => {
    const loading = startLoading(initialLoadState);
    const errored = loadFailed(loading, new Error('boom'));

    expect(errored.status).toBe('error');
    expect(canSave(errored)).toBe(false);
  });

  it('does not start a second load while one is in flight', () => {
    const loading = startLoading(initialLoadState);
    const sameState = startLoading(loading);
    expect(sameState).toBe(loading);
  });

  it('does not start a save while the form is loading or in error', () => {
    expect(canSave(startLoading(initialLoadState))).toBe(false);
    expect(canSave(loadFailed(startLoading(initialLoadState), new Error('x')))).toBe(false);
  });

  it('clears the error on a successful retry of the load', () => {
    const errored = loadFailed(startLoading(initialLoadState), new Error('first failure'));
    const reloading = startLoading(errored);
    const ready = loadSucceeded(reloading);

    expect(ready.status).toBe('ready');
    expect(ready.error).toBeNull();
    expect(canSave(ready)).toBe(true);
  });

  it('blocks save while saving=true', () => {
    const ready = loadSucceeded(startLoading(initialLoadState));
    const saving = startSaving(ready);
    expect(canSave(saving)).toBe(false);
    expect(saving.saving).toBe(true);
  });

  it('returns to ready and remains saveable when the save finishes without error', () => {
    const ready = loadSucceeded(startLoading(initialLoadState));
    const saving = startSaving(ready);
    const done = saveFinished(saving);

    expect(done.status).toBe('ready');
    expect(done.saving).toBe(false);
    expect(canSave(done)).toBe(true);
  });

  it('keeps status=ready when a save fails but allows the user to retry', () => {
    const ready = loadSucceeded(startLoading(initialLoadState));
    const saving = startSaving(ready);
    const failed = saveFinished(saving, new Error('invalid_diet'));

    expect(failed.status).toBe('ready');
    expect(failed.saving).toBe(false);
    expect(canSave(failed)).toBe(true);
  });
});
