// Today as a 'YYYY-MM-DD' key in local time, the form the plan writes its dates in. The list
// reads the clock here and nowhere else: its rules take the day as an argument.
export function getTodayKey(now: Date = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}
