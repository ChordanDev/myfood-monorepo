// Payloads of `planning:<accountId>` that the Planner screen reads (issue #25). The shapes are
// frozen in apps/api/docs/CHANNELS.md and recorded as JSON in ../fixtures by the API channel
// tests. Every parser rejects a missing key, an extra key and a wrong type, so a drift on
// either side fails a test instead of reaching the screen as `undefined`.

export const PLANNER_MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type PlannerMealSlot = (typeof PLANNER_MEAL_SLOTS)[number];

export interface StartPlanningReply {
  sessionId: string;
  status: 'active';
}

export interface SessionStartedPayload {
  sessionId: string;
}

// `session_cancelled`, `session_expired` and `session_lost_lock` all say which session ended.
export type SessionEndedPayload = SessionStartedPayload;

// `start_planning` is the only command that emits this event.
export interface GenerationStartedPayload {
  requestId: string;
  runId: string;
  sessionId: string;
}

// The producer sends decimals (`12.5`) and `null` for a macro it does not know.
export interface PlannerMealMacros {
  proteinG: number | null;
  carbsG: number | null;
  calories: number | null;
}

export interface PlannerMeal {
  slot: PlannerMealSlot;
  recipeId: string;
  recipeName: string;
  // `null` when the price of the recipe is unknown.
  priceCents: number | null;
  macros: PlannerMealMacros;
}

export interface PlannerDay {
  date: string;
  costCents: number;
  meals: PlannerMeal[];
}

export interface ProposalReadyPayload {
  proposalId: string;
  runId: string;
  estimatedCostCents: number;
  days: PlannerDay[];
}

export interface PlanningMessagePayload {
  role: 'assistant';
  text: string;
  proposalId: string;
  runId: string;
  summary: { dayCount: number; mealCount: number; estimatedCostCents: number };
}

export interface GenerationErrorPayload {
  // The raw reason of the generation ("optimization_failed", "already_running"), not an ApiError
  // code.
  reason: string;
  details: Record<string, unknown>;
  runId: string | null;
  requestId: string | null;
}

// The error envelope of a refused `start_planning`: the two codes this feature adds, plus the
// owner display name `planning_range_locked` carries when another member holds the range.
export interface PlanningInvalidRangeError {
  error: { code: 'planning_invalid_range'; message: string };
}

export interface PlanningRangeLockedError {
  error: {
    code: 'planning_range_locked';
    message: string;
    details?: { ownerName: string };
  };
}

// `POST /api/planning/confirm` committed the session (issue #28): its meals are scheduled and the
// Shopping list was rebuilt. The topic says the same with `session_committed`.
export interface SessionCommittedPayload {
  sessionId: string;
  proposalId: string;
  scheduledMealsCount: number;
  shoppingRebuilt: boolean;
}

// The `data` of `POST /api/planning/confirm`. A proposal confirmed before answers the same.
export interface ConfirmProposalReply extends SessionCommittedPayload {
  status: 'committed';
}

// `start_planning` refused a range that already has Scheduled meals in the slots it plans.
export interface PlanningSlotOccupiedError {
  error: {
    code: 'planning_slot_occupied';
    message: string;
    details: { occupied: { date: string; slot: PlannerMealSlot }[] };
  };
}

type Shape<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string): never {
  throw new Error(`Planner payload drift at ${path}: expected ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str: Shape<string> = (value, path) =>
  typeof value === 'string' ? value : fail(path, 'a string');

const int: Shape<number> = (value, path) =>
  typeof value === 'number' && Number.isInteger(value) ? value : fail(path, 'an integer');

const bool: Shape<boolean> = (value, path) =>
  typeof value === 'boolean' ? value : fail(path, 'a boolean');

const num: Shape<number> = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail(path, 'a number');

function literal<T extends string>(allowed: readonly T[]): Shape<T> {
  return (value, path) => {
    const match = allowed.find((candidate) => candidate === value);
    return match ?? fail(path, `one of ${allowed.join(', ')}`);
  };
}

function nullable<T>(shape: Shape<T>): Shape<T | null> {
  return (value, path) => (value === null ? null : shape(value, path));
}

function list<T>(shape: Shape<T>): Shape<T[]> {
  return (value, path) =>
    Array.isArray(value)
      ? value.map((item: unknown, index) => shape(item, `${path}[${index}]`))
      : fail(path, 'an array');
}

// An object whose keys are exactly `fields`; `optional` keys may be absent.
function record<T>(
  fields: { [K in keyof T]-?: Shape<T[K]> },
  optional: readonly (keyof T)[] = []
): Shape<T> {
  return (value, path) => {
    if (!isRecord(value)) return fail(path, 'an object');
    const keys = Object.keys(fields);
    const extra = Object.keys(value).filter((key) => !keys.includes(key));
    if (extra.length > 0) fail(path, `no key ${extra.join(', ')}`);

    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (!(key in value)) {
        if (optional.some((name) => name === key)) continue;
        fail(`${path}.${key}`, 'a value');
      }
      const shape = (fields as Record<string, Shape<unknown>>)[key];
      out[key] = shape(value[key], `${path}.${key}`);
    }
    return out as T;
  };
}

const anyRecord: Shape<Record<string, unknown>> = (value, path) =>
  isRecord(value) ? value : fail(path, 'an object');

const macros = record<PlannerMealMacros>({
  proteinG: nullable(num),
  carbsG: nullable(num),
  calories: nullable(num),
});

const meal = record<PlannerMeal>({
  slot: literal(PLANNER_MEAL_SLOTS),
  recipeId: str,
  recipeName: str,
  priceCents: nullable(int),
  macros,
});

const day = record<PlannerDay>({ date: str, costCents: int, meals: list(meal) });

const parseWith =
  <T>(name: string, shape: Shape<T>) =>
  (payload: unknown): T =>
    shape(payload, name);

export const parseStartPlanningReply = parseWith(
  'startPlanningReply',
  record<StartPlanningReply>({ sessionId: str, status: literal(['active'] as const) })
);

export const parseSessionStarted = parseWith(
  'sessionStarted',
  record<SessionStartedPayload>({ sessionId: str })
);

const sessionEnded = record<SessionEndedPayload>({ sessionId: str });

export const parseSessionCancelled = parseWith('sessionCancelled', sessionEnded);
export const parseSessionExpired = parseWith('sessionExpired', sessionEnded);
export const parseSessionLostLock = parseWith('sessionLostLock', sessionEnded);

export const parseGenerationStarted = parseWith(
  'generationStarted',
  record<GenerationStartedPayload>({ requestId: str, runId: str, sessionId: str })
);

export const parseProposalReady = parseWith(
  'proposalReady',
  record<ProposalReadyPayload>({
    proposalId: str,
    runId: str,
    estimatedCostCents: int,
    days: list(day),
  })
);

export const parsePlanningMessage = parseWith(
  'planningMessage',
  record<PlanningMessagePayload>({
    role: literal(['assistant'] as const),
    text: str,
    proposalId: str,
    runId: str,
    summary: record({ dayCount: int, mealCount: int, estimatedCostCents: int }),
  })
);

export const parseGenerationError = parseWith(
  'generationError',
  record<GenerationErrorPayload>({
    reason: str,
    details: anyRecord,
    runId: nullable(str),
    requestId: nullable(str),
  })
);

export const parsePlanningInvalidRangeError = parseWith(
  'planningInvalidRangeError',
  record<PlanningInvalidRangeError>({
    error: record({ code: literal(['planning_invalid_range'] as const), message: str }),
  })
);

export const parsePlanningRangeLockedError = parseWith(
  'planningRangeLockedError',
  record<PlanningRangeLockedError>({
    error: record<PlanningRangeLockedError['error']>(
      {
        code: literal(['planning_range_locked'] as const),
        message: str,
        details: record({ ownerName: str }),
      },
      ['details']
    ),
  })
);

export const parseSessionCommitted = parseWith(
  'sessionCommitted',
  record<SessionCommittedPayload>({
    sessionId: str,
    proposalId: str,
    scheduledMealsCount: int,
    shoppingRebuilt: bool,
  })
);

export const parseConfirmProposalReply = parseWith(
  'confirmProposalReply',
  record<ConfirmProposalReply>({
    sessionId: str,
    proposalId: str,
    scheduledMealsCount: int,
    shoppingRebuilt: bool,
    status: literal(['committed'] as const),
  })
);

export const parsePlanningSlotOccupiedError = parseWith(
  'planningSlotOccupiedError',
  record<PlanningSlotOccupiedError>({
    error: record<PlanningSlotOccupiedError['error']>({
      code: literal(['planning_slot_occupied'] as const),
      message: str,
      details: record({
        occupied: list(record({ date: str, slot: literal(PLANNER_MEAL_SLOTS) })),
      }),
    }),
  })
);
