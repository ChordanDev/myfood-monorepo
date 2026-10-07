export interface StartHomeBypassEnvironment {
  isDevelopment?: boolean;
  startHomeFlag?: string;
}

export function isStartHomeBypassEnabled({
  isDevelopment = __DEV__,
  startHomeFlag = process.env.EXPO_PUBLIC_START_HOME,
}: StartHomeBypassEnvironment = {}): boolean {
  return isDevelopment && startHomeFlag === 'true';
}

export interface TabsGateInput {
  isAuthenticated: boolean;
  isLoading: boolean;
  canUseApp: boolean;
  isComplete: boolean;
}

export type TabsGate = 'Loading' | 'RedirectToIndex' | 'Tabs';

export function resolveTabsGate(
  input: TabsGateInput,
  startHomeBypassEnabled = isStartHomeBypassEnabled()
): TabsGate {
  if (startHomeBypassEnabled) {
    return 'Tabs';
  }

  if (input.isLoading) {
    return 'Loading';
  }

  if (!input.isAuthenticated || !input.canUseApp || !input.isComplete) {
    return 'RedirectToIndex';
  }

  return 'Tabs';
}
