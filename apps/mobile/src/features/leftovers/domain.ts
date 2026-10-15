import type { CreatePreparedLeftoverInput } from './types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "2026-10-11" as "11 oct". Read from the text, so no device time zone moves the day.
export function formatConsumeBy(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number);
  const name = MONTHS[month - 1];

  return name === undefined || Number.isNaN(day) ? isoDate : `${day} ${name}`;
}

export function formatPortions(portions: number): string {
  return portions === 1 ? '1 porción' : `${portions} porciones`;
}

// The server's limits for a new leftover: the title column, the portions cap and the notes cap.
export const LEFTOVER_TITLE_MAX_LENGTH = 255;
export const LEFTOVER_PORTIONS_MAX = 1000;
export const LEFTOVER_NOTES_MAX_LENGTH = 500;

const WHOLE_NUMBER_PATTERN = /^\d+$/;

export interface LeftoverDraft {
  title: string;
  portionsText: string;
  notes: string;
}

/**
 * What a loose leftover sends, or null while the title is blank or the portions are not a whole
 * number the server takes. Blank notes are not sent.
 */
export function readLeftoverDraft(draft: LeftoverDraft): CreatePreparedLeftoverInput | null {
  const title = draft.title.trim();
  const portionsText = draft.portionsText.trim();
  if (title.length === 0 || !WHOLE_NUMBER_PATTERN.test(portionsText)) return null;

  const portions = Number(portionsText);
  if (portions < 1 || portions > LEFTOVER_PORTIONS_MAX) return null;

  const notes = draft.notes.trim();
  return notes.length === 0 ? { title, portions } : { title, portions, notes };
}
