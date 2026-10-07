import type { AuthUser, CurrentMe, ProfileUpdateUser } from '../types/auth';

type ProfileFields = Pick<AuthUser, 'displayName' | 'householdSize' | 'cookingSkill'>;

// Absent profile fields become null so every reader handles
// `value | null` and never `undefined`. Shared by every place a user
// object enters the app: /api/me, a stored session and the profile
// update response.
export function normalizeProfileFields<T extends Partial<ProfileFields>>(
  user: T
): T & ProfileFields {
  return {
    ...user,
    displayName: user.displayName ?? null,
    householdSize: user.householdSize ?? null,
    cookingSkill: user.cookingSkill ?? null,
  };
}

// The backend does not send the profile fields on /api/me yet, and
// sessions stored by earlier builds lack them too.
export function normalizeCurrentMe(me: CurrentMe): CurrentMe {
  return { ...me, user: normalizeProfileFields(me.user) };
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
