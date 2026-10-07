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

// GET /api/me does not send householdSize or cookingSkill yet, so a fresh
// snapshot would erase the values a completed onboarding or a profile
// edit already put in `me`. Only fields the fresh snapshot lacks are
// filled, and only for the same user: a value the server does send wins.
export function withPreservedProfileFields(
  fresh: CurrentMe,
  previous: CurrentMe | null
): CurrentMe {
  if (!previous || previous.user.id !== fresh.user.id) return fresh;

  const householdSize = fresh.user.householdSize ?? previous.user.householdSize;
  const cookingSkill = fresh.user.cookingSkill ?? previous.user.cookingSkill;
  if (householdSize === fresh.user.householdSize && cookingSkill === fresh.user.cookingSkill) {
    return fresh;
  }
  return { ...fresh, user: { ...fresh.user, householdSize, cookingSkill } };
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
