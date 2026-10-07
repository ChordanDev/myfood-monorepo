// Pure formatters for the settings screen rows and account card.
//
// No React and no clock access: callers pass the current date in, so
// every output is a deterministic function of its arguments and can be
// unit-tested without rendering or mocking timers.

import type {
  AuthAccount,
  AuthSubscriptionStatus,
  CookingSkill,
  SlotCookingTime,
} from '@/features/auth/types/auth';
import {
  DIET_LABELS,
  HARD_RESTRICTION_LABELS,
  isValidDietCode,
  isValidHardRestrictionCode,
} from '@/features/preferences/constants/catalog';
import {
  COOKING_SKILL_LABELS,
  HUNGER_LEVEL_LABELS,
} from '@/features/preferences/constants/preferenceOptions';
import { ACCOUNT_TYPE_LABELS } from '../constants/settingsLabels';

const MAX_INITIALS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UNDEFINED_LABEL = 'Sin definir';
const EMPTY_LIST_LABEL = 'Ninguna';
const LIST_SEPARATOR = ', ';

// Fixed names instead of Intl so the output never depends on the device ICU data.
const SHORT_MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

const SUBSCRIPTION_LABELS: Record<Exclude<AuthSubscriptionStatus, 'none'>, string> = {
  active: 'activa',
  past_due: 'pago pendiente',
  canceled: 'cancelada',
};

export interface TrialState {
  isInTrial: boolean;
  /** Whole days until the trial ends, rounded up. 0 outside the trial. */
  daysLeft: number;
}

const NOT_IN_TRIAL: TrialState = { isInTrial: false, daysLeft: 0 };

export function getInitials(displayName: string | null, email: string): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  const source = words.length > 0 ? words.slice(0, MAX_INITIALS) : [email.trim()];
  return source.map((word) => word.charAt(0).toUpperCase()).join('');
}

export function getTrialState(
  account: Pick<AuthAccount, 'trialEndsAt' | 'subscriptionStatus'>,
  now: Date
): TrialState {
  if (account.subscriptionStatus !== 'none' || !account.trialEndsAt) return NOT_IN_TRIAL;

  const msLeft = new Date(account.trialEndsAt).getTime() - now.getTime();
  // NaN (unparseable date) fails this comparison too.
  if (!(msLeft > 0)) return NOT_IN_TRIAL;

  return { isInTrial: true, daysLeft: Math.ceil(msLeft / MS_PER_DAY) };
}

export function formatTrialPill(trial: TrialState): string | null {
  if (!trial.isInTrial) return null;
  return `Prueba · ${trial.daysLeft} ${trial.daysLeft === 1 ? 'día' : 'días'}`;
}

// Device-local calendar day: the user reads this date on their own calendar.
function formatShortDate(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

function describePlanStatus(
  account: Pick<AuthAccount, 'trialEndsAt' | 'subscriptionStatus'>,
  now: Date
): string | null {
  if (account.subscriptionStatus !== 'none') return SUBSCRIPTION_LABELS[account.subscriptionStatus];
  if (!account.trialEndsAt) return null;

  return getTrialState(account, now).isInTrial
    ? `prueba hasta ${formatShortDate(new Date(account.trialEndsAt))}`
    : 'prueba finalizada';
}

export function formatPlanSummary(
  account: Pick<AuthAccount, 'type' | 'trialEndsAt' | 'subscriptionStatus'>,
  now: Date
): string {
  const plan = ACCOUNT_TYPE_LABELS[account.type];
  const status = describePlanStatus(account, now);
  return status ? `${plan} · ${status}` : plan;
}

export function formatDisplayNameSummary(displayName: string | null): string {
  return displayName?.trim() || UNDEFINED_LABEL;
}

export function formatHouseholdSummary(householdSize: number | null): string {
  if (householdSize === null) return UNDEFINED_LABEL;
  return `${householdSize} ${householdSize === 1 ? 'comensal' : 'comensales'}`;
}

export function formatCookingSkillSummary(cookingSkill: CookingSkill | null): string {
  if (cookingSkill === null) return UNDEFINED_LABEL;
  return COOKING_SKILL_LABELS[cookingSkill];
}

export function formatCookingTime(cookingTimeMinutes: number): string {
  return cookingTimeMinutes === 0 ? 'No cocino' : `${cookingTimeMinutes} min`;
}

export function formatSlotSummary(slot: SlotCookingTime): string {
  return `${formatCookingTime(slot.cookingTimeMinutes)} · ${HUNGER_LEVEL_LABELS[slot.hungerLevel]}`;
}

// The API types diet and restrictions as plain strings. A code the catalog
// does not know has no label, so it is never printed raw.
export function formatDietSummary(diet: string | null): string {
  return isValidDietCode(diet) ? DIET_LABELS[diet] : 'Sin preferencia';
}

// Unknown restriction codes are counted ("Gluten +1") instead of dropped:
// the row must never understate what the user is restricted from.
export function formatHardRestrictionsSummary(hardRestrictions: readonly string[]): string {
  if (hardRestrictions.length === 0) return EMPTY_LIST_LABEL;

  const labels = hardRestrictions
    .filter(isValidHardRestrictionCode)
    .map((code) => HARD_RESTRICTION_LABELS[code]);
  const unknownCount = hardRestrictions.length - labels.length;

  const parts = [labels.join(LIST_SEPARATOR)];
  if (unknownCount > 0) parts.push(`+${unknownCount}`);
  return parts.filter(Boolean).join(' ');
}

export function formatSoftPreferencesSummary(softPreferences: readonly string[]): string {
  return softPreferences.length > 0 ? softPreferences.join(LIST_SEPARATOR) : EMPTY_LIST_LABEL;
}
