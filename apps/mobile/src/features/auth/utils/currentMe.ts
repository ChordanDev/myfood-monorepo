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

// Sessions stored by earlier builds lack the profile fields and the
// account timezone. /api/me always
// sends them, as null until the server has stored a value.
export function normalizeCurrentMe(me: CurrentMe): CurrentMe {
  return {
    ...me,
    user: normalizeProfileFields(me.user),
    account: { ...me.account, timezone: me.account.timezone ?? null },
  };
}

// GET /api/me serves householdSize and cookingSkill as null until the
// server has stored them: a profile edit stores them, onboarding
// completion does not yet. A fresh snapshot would otherwise erase the
// values a completed onboarding already put in `me`. Only fields the fresh
// snapshot lacks are filled, and only for the same user: a value the
// server does send wins.
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

// Copies the timezone the server just stored into `me`, leaving the rest
// of the snapshot untouched.
export function withAccountTimezone(me: CurrentMe, timezone: string): CurrentMe {
  return { ...me, account: { ...me.account, timezone } };
}
