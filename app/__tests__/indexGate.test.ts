import { resolveIndexGate } from '../indexGate';

describe('resolveIndexGate', () => {
  const baseState = {
    isAuthenticated: false,
    isComplete: false,
    canUseApp: false,
  } as const;

  it('routes unauthenticated users to AuthLanding', () => {
    const result = resolveIndexGate({
      isAuthenticated: false,
      isComplete: false,
      canUseApp: false,
    });

    expect(result).toBe('AuthLanding');
  });

  it('routes authenticated users with incomplete onboarding to Onboarding, even when locked', () => {
    const result = resolveIndexGate({
      isAuthenticated: true,
      isComplete: false,
      canUseApp: false,
    });

    expect(result).toBe('Onboarding');
  });

  it('routes authenticated usable users with incomplete onboarding to Onboarding', () => {
    const result = resolveIndexGate({
      isAuthenticated: true,
      isComplete: false,
      canUseApp: true,
    });

    expect(result).toBe('Onboarding');
  });

  it('routes authenticated locked users with complete onboarding to TrialExpired', () => {
    const result = resolveIndexGate({
      isAuthenticated: true,
      isComplete: true,
      canUseApp: false,
    });

    expect(result).toBe('TrialExpired');
  });

  it('routes authenticated usable users with complete onboarding to Tabs', () => {
    const result = resolveIndexGate({
      isAuthenticated: true,
      isComplete: true,
      canUseApp: true,
    });

    expect(result).toBe('Tabs');
  });

  it('ignores baseState reference identity and only reads own fields', () => {
    expect(baseState).toEqual({
      isAuthenticated: false,
      isComplete: false,
      canUseApp: false,
    });
  });
});
