import { useEffect, useState } from 'react';

interface UseResendCooldownResult {
  secondsLeft: number;
  canResend: boolean;
  restart: () => void;
}

export function useResendCooldown(initialSeconds = 45): UseResendCooldownResult {
  // Cuenta regresiva en segundos para habilitar reenvio.
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }

    const timer = setInterval(() => {
      // Decrementa hasta cero y mantiene el limite.
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft]);

  const restart = () => {
    setSecondsLeft(initialSeconds);
  };

  return {
    secondsLeft,
    canResend: secondsLeft === 0,
    restart,
  };
}
