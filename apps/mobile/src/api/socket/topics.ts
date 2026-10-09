/** The planning channel topic of an Account. */
export function planningTopic(accountId: string): string {
  return `planning:${accountId}`;
}
