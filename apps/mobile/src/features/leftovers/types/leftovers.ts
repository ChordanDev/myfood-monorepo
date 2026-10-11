// A portion batch cooked and kept apart from Inventory. Dates are ISO strings of the server.
export interface PreparedLeftover {
  id: string;
  sourceMealId: string | null;
  title: string;
  portions: number;
  storedAt: string;
  // ISO date (YYYY-MM-DD): the last day it should be eaten.
  consumeByDate: string;
  notes: string | null;
  consumedAt: string | null;
  discardedAt: string | null;
}

export interface CreatePreparedLeftoverInput {
  title: string;
  portions: number;
  // Not sent when unset: the server then defaults to the Account's today plus three days.
  consumeByDate?: string;
  notes?: string;
  // The Scheduled meal the portions were cooked for; the answer names it as `sourceMealId`.
  scheduledMealId?: string;
}
