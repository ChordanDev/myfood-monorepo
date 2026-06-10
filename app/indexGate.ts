// Pure gate resolver for the app/index.tsx route decision.
// Extracted so the routing logic is unit-testable without rendering React.
// Order: unauth -> Onboarding (even if locked) -> TrialExpired (locked+complete) -> Tabs (usable+complete).

export type IndexRoute = 'AuthLanding' | 'Onboarding' | 'TrialExpired' | 'Tabs';

export interface IndexGateInput {
  isAuthenticated: boolean;
  isComplete: boolean;
  canUseApp: boolean;
}

export function resolveIndexGate(input: IndexGateInput): IndexRoute {
  if (!input.isAuthenticated) {
    return 'AuthLanding';
  }

  if (!input.isComplete) {
    return 'Onboarding';
  }

  if (!input.canUseApp) {
    return 'TrialExpired';
  }

  return 'Tabs';
}
