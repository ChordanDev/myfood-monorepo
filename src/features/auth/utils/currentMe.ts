import type { CurrentMe, ProfileUpdateUser } from '../types/auth';

// The backend does not send the profile fields on /api/me yet, and
// sessions stored by earlier builds lack them too. Absent fields become
// null so every reader handles `value | null` and never `undefined`.
export function normalizeCurrentMe(me: CurrentMe): CurrentMe {
  return {
    ...me,
    user: {
      ...me.user,
      householdSize: me.user.householdSize ?? null,
      cookingSkill: me.user.cookingSkill ?? null,
    },
  };
}

// Copies only the editable profile fields from a profile-update response,
// leaving the account, membership and onboarding snapshot untouched.
export function withUpdatedProfile(me: CurrentMe, user: ProfileUpdateUser): CurrentMe {
  return {
    ...me,
    user: {
      ...me.user,
      displayName: user.displayName,
      householdSize: user.householdSize,
      cookingSkill: user.cookingSkill,
    },
  };
}
