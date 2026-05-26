import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { useEmailValidation } from '../hooks';
import { EmailTextInput } from './EmailTextInput';
import { InputErrorText } from './InputErrorText';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface AuthCredentialsFormProps {
  metrics: AuthLandingMetrics;
  onValidityChange?: (isValid: boolean) => void;
  onCredentialsChange?: (credentials: { email: string }) => void;
}

export function AuthCredentialsForm({
  metrics,
  onValidityChange,
  onCredentialsChange,
}: AuthCredentialsFormProps) {
  // Estado local del email para validacion en tiempo real.
  const [email, setEmail] = useState('');
  const { theme } = useRecipeTheme();

  const { normalizedEmail, isValidEmail } = useEmailValidation(email);
  const isFormValid = isValidEmail;
  const showEmailError = email.length > 0 && !isValidEmail;

  useEffect(() => {
    // Propaga validez y credenciales normalizadas al padre.
    onValidityChange?.(isFormValid);
    onCredentialsChange?.({ email: normalizedEmail });
  }, [isFormValid, normalizedEmail, onCredentialsChange, onValidityChange]);

  return (
    <View style={{ paddingHorizontal: metrics.formHorizontalPadding }}>
      <View
        className="w-full"
        style={{
          backgroundColor: theme.icon,
          borderRadius: metrics.formContainerRadius,
          overflow: 'hidden',
        }}>
        <EmailTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Correo electrónico"
          placeholderTextColor={theme.textLight}
          style={{
            color: theme.textBlack,
            fontSize: metrics.formFieldFontSize,
            paddingVertical: metrics.formFieldVerticalPadding,
            paddingHorizontal: metrics.formFieldHorizontalPadding,
          }}
        />
      </View>

      <View className="items-center" style={{ paddingTop: showEmailError ? 6 : 0 }}>
        <InputErrorText
          visible={showEmailError}
          text="Ingresa un correo válido (ejemplo@dominio.com)."
          className="font-inter-medium"
          style={{
            color: theme.primaryAccent,
            fontSize: metrics.formErrorFontSize,
            textAlign: 'center',
          }}
        />
      </View>
    </View>
  );
}
