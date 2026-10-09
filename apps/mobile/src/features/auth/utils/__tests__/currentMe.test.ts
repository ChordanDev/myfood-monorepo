import type { CurrentMe } from '@/features/auth/types/auth';
import { normalizeCurrentMe, withAccountTimezone, withPreservedProfileFields } from '../currentMe';

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

describe('withPreservedProfileFields', () => {
  // GET /api/me does not send householdSize or cookingSkill yet, so a fresh
  // snapshot must not erase the values a previous one already carried.
  it('fills profile fields the fresh snapshot lacks from the previous one', () => {
    const previous = makeMe({
      displayName: 'Lucca',
      householdSize: 2,
      cookingSkill: 'intermediate',
    });
    const fresh = makeMe({ displayName: 'Lucca' });

    const result = withPreservedProfileFields(fresh, previous);

    expect(result.user).toEqual({
      ...fresh.user,
      householdSize: 2,
      cookingSkill: 'intermediate',
    });
  });

  it('keeps the fresh values when the server does send them', () => {
    const previous = makeMe({ householdSize: 2, cookingSkill: 'intermediate' });
    const fresh = makeMe({ displayName: 'Lucca G.', householdSize: 4, cookingSkill: 'advanced' });

    expect(withPreservedProfileFields(fresh, previous)).toBe(fresh);
  });

  it('never copies fields across different users', () => {
    const previous = makeMe({ id: 'user-2', householdSize: 2, cookingSkill: 'intermediate' });
    const fresh = makeMe();

    expect(withPreservedProfileFields(fresh, previous)).toBe(fresh);
  });

  it('returns the fresh snapshot untouched without a previous one', () => {
    const fresh = makeMe();

    expect(withPreservedProfileFields(fresh, null)).toBe(fresh);
  });

  it('does not resurrect a display name the server reports as cleared', () => {
    const previous = makeMe({ displayName: 'Lucca', householdSize: 2, cookingSkill: 'beginner' });
    const fresh = makeMe({ displayName: null });

    const result = withPreservedProfileFields(fresh, previous);

    // displayName is already served by /api/me, so null there means null.
    expect(result.user.displayName).toBeNull();
    expect(result.user.householdSize).toBe(2);
  });
});

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
