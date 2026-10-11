import type { CurrentMe } from '@/features/auth/types/auth';
import { normalizeCurrentMe, withAccountTimezone } from '../currentMe';

function makeMe(user: Partial<CurrentMe['user']> = {}): CurrentMe {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      householdSize: null,
      cookingSkill: null,
      ...user,
    },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      timezone: null,
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
}

describe('account timezone', () => {
  it('defaults a stored session without timezone to null', () => {
    const stored = makeMe();
    delete (stored.account as { timezone?: string | null }).timezone;

    expect(normalizeCurrentMe(stored).account.timezone).toBeNull();
  });

  it('keeps a reported timezone', () => {
    const me = withAccountTimezone(makeMe(), 'Europe/Madrid');

    expect(normalizeCurrentMe(me).account.timezone).toBe('Europe/Madrid');
  });
});
