import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResendCooldownResult {
  secondsLeft: number;
  canResend: boolean;
  restart: (nextSeconds?: number) => void;
}

export function useResendCooldown(initialSeconds = 45): UseResendCooldownResult {
  // Cuenta regresiva en segundos para habilitar reenvio.
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizes cooldown when its initial duration changes.
    setSecondsLeft(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      clearTimer();
      return;
    }

    // Crea un unico interval que decrementa hasta cero.
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTimer;
    // Solo depende de si secondsLeft pasa de 0 a >0 (restart).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft > 0]);

  const restart = useCallback(
    (nextSeconds?: number) => {
      clearTimer();
      setSecondsLeft(nextSeconds ?? initialSeconds);
    },
    [clearTimer, initialSeconds]
  );

  return {
    secondsLeft,
    canResend: secondsLeft === 0,
    restart,
  };
}
