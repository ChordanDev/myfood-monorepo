import { useMemo } from 'react';

export const EMAIL_MAX_LENGTH = 80;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UseEmailValidationResult {
  normalizedEmail: string;
  isValidEmail: boolean;
}

export function useEmailValidation(email: string): UseEmailValidationResult {
  // Normaliza el email antes de validar.
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const isValidEmail = EMAIL_REGEX.test(normalizedEmail);

  return {
    normalizedEmail,
    isValidEmail,
  };
}
