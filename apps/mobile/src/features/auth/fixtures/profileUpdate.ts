import { COOKING_SKILLS } from '@/features/preferences/constants/preferenceOptions';
import type { ProfileUpdateResponse } from '../types/auth';
import { oneOf } from './oneOf';
import profileUpdate from './profileUpdate.json';

// The frozen `PUT /api/me/profile` body. The Cooking skill is narrowed here; every other
// field is checked against `ProfileUpdateResponse` by the compiler.
export function fixtureProfileUpdate(): ProfileUpdateResponse {
  const { user } = profileUpdate;

  return { user: { ...user, cookingSkill: oneOf(COOKING_SKILLS, user.cookingSkill) } };
}
