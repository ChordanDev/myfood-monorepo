import { COOKING_SKILLS } from '@/features/preferences/constants/preferenceOptions';
import type {
  AuthAccountType,
  AuthMembershipRole,
  AuthSubscriptionStatus,
  CurrentMe,
} from '../types/auth';
import currentMe from './currentMe.json';
import currentMeBeforeOnboarding from './currentMeBeforeOnboarding.json';
import { oneOf } from './oneOf';

const ACCOUNT_TYPES: readonly AuthAccountType[] = ['individual', 'family', 'family_plus'];
const SUBSCRIPTION_STATUSES: readonly AuthSubscriptionStatus[] = [
  'none',
  'active',
  'past_due',
  'canceled',
];
const MEMBERSHIP_ROLES: readonly AuthMembershipRole[] = ['owner', 'member'];

type FrozenAccount = Omit<CurrentMe['account'], 'type' | 'subscriptionStatus'> & {
  type: string;
  subscriptionStatus: string;
};

function narrowAccount(account: FrozenAccount): CurrentMe['account'] {
  return {
    ...account,
    type: oneOf(ACCOUNT_TYPES, account.type),
    subscriptionStatus: oneOf(SUBSCRIPTION_STATUSES, account.subscriptionStatus),
    access: { ...account.access },
  };
}

// The frozen `GET /api/me` body of a User who finished Onboarding. The union fields are
// narrowed here; every other field is checked against `CurrentMe` by the compiler.
export function fixtureCurrentMe(): CurrentMe {
  return {
    user: { ...currentMe.user, cookingSkill: oneOf(COOKING_SKILLS, currentMe.user.cookingSkill) },
    account: narrowAccount(currentMe.account),
    membership: { role: oneOf(MEMBERSHIP_ROLES, currentMe.membership.role) },
    onboarding: { ...currentMe.onboarding },
  };
}

// The frozen `GET /api/me` body of a User who has not finished Onboarding: no profile yet.
export function fixtureCurrentMeBeforeOnboarding(): CurrentMe {
  return {
    user: { ...currentMeBeforeOnboarding.user },
    account: narrowAccount(currentMeBeforeOnboarding.account),
    membership: { role: oneOf(MEMBERSHIP_ROLES, currentMeBeforeOnboarding.membership.role) },
    onboarding: { ...currentMeBeforeOnboarding.onboarding },
  };
}
