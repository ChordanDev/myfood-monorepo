// Tipos de autenticacion. Contrato que el backend real debera respetar.

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
}

export interface AuthState {
  /** El usuario autenticado, o null si no hay sesion. */
  user: AuthUser | null;
  /** Token JWT (o mock) de la sesion activa. */
  token: string | null;
  /** True mientras se verifica si hay sesion al abrir la app. */
  isLoading: boolean;
  /** Derivado: user !== null. */
  isAuthenticated: boolean;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, code: string) => Promise<void>;
  signUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendVerificationCode: (email: string) => Promise<void>;
}
