// Hook wrapper for the pure `resolveIndexGate` resolver.
//
// The bug fixed in `fix/onboarding-redirect-loop` was a ping-pong between
// `app/index.tsx` and `app/onboarding.tsx`. Root cause: `IndexScreen` was
// recomputing the route on every render and reading isComplete directly
// from `me?.onboarding.isComplete` (the server-confirmed value) instead
// of from the `AuthContext.isComplete` (which also reflects the optimistic
// "I just submitted onboarding" flag). When the user submitted onboarding
// the optimistic flag was set, OnboardingScreen redirected to "/", but
// IndexScreen read the still-stale `me.onboarding.isComplete` and
// redirected back to "/onboarding", which flipped the optimistic flag
// back to "/" and so on.
//
// This hook:
//   1. Consumes `useAuth()` and reads the unified `isComplete` (with
//      optimistic flag).
//   2. Memoizes the resolved route string on the gate's three primitive
//      inputs so the returned string identity is stable across re-renders
//      that don't change the gate's input. The previous fix at the
//      `AuthContext` layer already preserves `me` reference identity for
//      content-equal refreshes; this hook makes the gate's output stable
//      too.

import { useMemo } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isStartHomeBypassEnabled } from '@/navigation/start-home-bypass';
import { resolveIndexGate, type IndexRoute } from './indexGate';

export function useIndexRoute(startHomeBypassEnabled = isStartHomeBypassEnabled()): IndexRoute {
  const { isAuthenticated, isComplete, canUseApp } = useAuth();
  return useMemo(
    () => resolveIndexGate({ isAuthenticated, isComplete, canUseApp }, startHomeBypassEnabled),
    [isAuthenticated, isComplete, canUseApp, startHomeBypassEnabled]
  );
}
