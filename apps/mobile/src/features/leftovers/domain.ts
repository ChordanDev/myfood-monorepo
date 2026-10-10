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
