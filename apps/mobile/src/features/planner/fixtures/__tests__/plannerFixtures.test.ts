import generationError from '../generationError.json';
import generationStarted from '../generationStarted.json';
import planningInvalidRangeError from '../planningInvalidRangeError.json';
import planningMessage from '../planningMessage.json';
import planningRangeLockedError from '../planningRangeLockedError.json';
import proposalReady from '../proposalReady.json';
import sessionStarted from '../sessionStarted.json';
import startPlanningReply from '../startPlanningReply.json';
import {
  parseGenerationError,
  parseGenerationStarted,
  parsePlanningInvalidRangeError,
  parsePlanningMessage,
  parsePlanningRangeLockedError,
  parseProposalReady,
  parseSessionStarted,
  parseStartPlanningReply,
} from '../../types/planningEvents';

// The JSON files are written by the API channel tests (apps/api/docs/CHANNELS.md, "Planner
// fixtures"). If one of these fails, the API payload changed: regenerate the fixtures and update
// the types.
describe('Planner payload fixtures', () => {
  it.each([
    ['startPlanningReply', parseStartPlanningReply, startPlanningReply],
    ['sessionStarted', parseSessionStarted, sessionStarted],
    ['generationStarted', parseGenerationStarted, generationStarted],
    ['proposalReady', parseProposalReady, proposalReady],
    ['planningMessage', parsePlanningMessage, planningMessage],
    ['generationError', parseGenerationError, generationError],
    ['planningInvalidRangeError', parsePlanningInvalidRangeError, planningInvalidRangeError],
    ['planningRangeLockedError', parsePlanningRangeLockedError, planningRangeLockedError],
  ] as const)('%s matches its type', (_name, parse, fixture) => {
    expect(() => parse(fixture)).not.toThrow();
  });

  it('keeps the values the screen depends on', () => {
    const ready = parseProposalReady(proposalReady);
    expect(ready.days.map((day) => day.date)).toEqual(['2030-01-01', '2030-01-02']);
    expect(ready.days[0].meals[0].priceCents).toBeNull();
    expect(ready.estimatedCostCents).toBe(1950);

    expect(parsePlanningRangeLockedError(planningRangeLockedError).error.details?.ownerName).toBe(
      'Ana Peer'
    );
  });

  it('rejects a payload with a missing, extra or mistyped key', () => {
    const { runId: _runId, ...withoutRunId } = generationStarted;
    expect(() => parseGenerationStarted(withoutRunId)).toThrow(/runId/);
    expect(() => parseGenerationStarted({ ...generationStarted, runId: 7 })).toThrow(/runId/);
    expect(() => parseSessionStarted({ ...sessionStarted, extra: 1 })).toThrow(/extra/);
    expect(() => parseProposalReady({ ...proposalReady, estimatedCostCents: '1950' })).toThrow(
      /estimatedCostCents/
    );
  });
});
