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
    resendMessage: 'Rev\u00edsalo en tu correo y vuelve a intentarlo.',
    successRedirectPath: '/',
  },
  login: {
    successTitle: 'Sesi\u00f3n iniciada',
    successMessage: 'Tu c\u00f3digo fue validado correctamente.',
    resendMessage: 'Te enviamos un nuevo c\u00f3digo para iniciar sesi\u00f3n.',
    successRedirectPath: '/home',
  },
};

export function resolveStringParam(value: string | string[] | undefined): string {
  // Normaliza parametros que pueden venir como array.
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

export function resolveVerificationFlow(value: string | string[] | undefined): VerificationFlow {
  // Fallback seguro a register si el parametro es invalido.
  const rawFlow = resolveStringParam(value);
  return rawFlow === 'login' ? 'login' : 'register';
}

export function getVerificationFlowConfig(flow: VerificationFlow): VerificationFlowConfig {
  return VERIFICATION_FLOW_CONFIG[flow];
}
