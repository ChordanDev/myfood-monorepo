import type { PreparedLeftover } from '../types';

// Open leftovers as the server lists them: soonest consume-by date first.
export const LEFTOVER_LENTILS: PreparedLeftover = {
  id: 'leftover-1',
  sourceMealId: 'meal-1',
  title: 'Lentil stew',
  portions: 3,
  storedAt: '2026-10-09T12:00:00Z',
  consumeByDate: '2026-10-11',
  notes: 'In the blue container',
  consumedAt: null,
  discardedAt: null,
};

export const LEFTOVER_RICE: PreparedLeftover = {
  id: 'leftover-2',
  sourceMealId: null,
  title: 'Rice',
  portions: 1,
  storedAt: '2026-10-09T13:00:00Z',
  consumeByDate: '2026-10-12',
  notes: null,
  consumedAt: null,
  discardedAt: null,
};

export const OPEN_LEFTOVERS: PreparedLeftover[] = [LEFTOVER_LENTILS, LEFTOVER_RICE];

export const toLeftoversResponse = (data: PreparedLeftover[]) => ({ data });
export const toLeftoverResponse = (data: PreparedLeftover) => ({ data });
