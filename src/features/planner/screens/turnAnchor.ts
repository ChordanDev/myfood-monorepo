interface TurnTrailingSpaceInput {
  usableViewportHeight: number;
  topInset: number;
  activeTurnY: number | null;
  trailingSpaceY: number | null;
}

function isMeasured(position: number | null): position is number {
  return position !== null && Number.isFinite(position);
}

// Height of the space kept below the active turn so the list can scroll until the turn sits
// `topInset` below the top of the viewport, and no further.
export function resolveTurnTrailingSpace({
  usableViewportHeight,
  topInset,
  activeTurnY,
  trailingSpaceY,
}: TurnTrailingSpaceInput): number {
  const fullReservation = Math.max(0, usableViewportHeight - topInset);
  if (!Number.isFinite(fullReservation)) return 0;

  // A position that is missing, or left over from the previous turn, cannot size the space. The
  // full reservation keeps the anchor reachable until both rows of this turn are measured.
  if (!isMeasured(activeTurnY) || !isMeasured(trailingSpaceY) || trailingSpaceY < activeTurnY) {
    return fullReservation;
  }

  // The trailing space starts where the turn's own content ends, so this is what the turn
  // leaves empty below the anchored position.
  return Math.max(0, fullReservation - (trailingSpaceY - activeTurnY));
}
