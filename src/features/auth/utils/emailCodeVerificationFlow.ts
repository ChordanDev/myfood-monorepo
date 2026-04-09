export type VerificationFlow = 'register' | 'login';

interface VerificationFlowConfig {
  successTitle: string;
  successMessage: string;
  resendMessage: string;
  successRedirectPath: string;
}

const VERIFICATION_FLOW_CONFIG: Record<VerificationFlow, VerificationFlowConfig> = {
  register: {
    successTitle: 'Cuenta verificada',
    successMessage: 'Tu correo fue validado correctamente.',
    resendMessage: 'Revisalo en tu correo y vuelve a intentarlo.',
    successRedirectPath: '/',
  },
  login: {
    successTitle: 'Sesion iniciada',
    successMessage: 'Tu codigo fue validado correctamente.',
    resendMessage: 'Te enviamos un nuevo codigo para iniciar sesion.',
    successRedirectPath: '/home',
  },
};

export function resolveStringParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

export function resolveVerificationFlow(value: string | string[] | undefined): VerificationFlow {
  const rawFlow = resolveStringParam(value);
  return rawFlow === 'login' ? 'login' : 'register';
}

export function getVerificationFlowConfig(flow: VerificationFlow): VerificationFlowConfig {
  return VERIFICATION_FLOW_CONFIG[flow];
}
