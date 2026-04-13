import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';
import { useEmailValidation } from '../hooks';
import { EmailTextInput } from './EmailTextInput';
import { InputErrorText } from './InputErrorText';

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
        className="w-full bg-[#E5D8C4]"
        style={{
          borderRadius: metrics.formContainerRadius,
          overflow: 'hidden',
        }}>
        <EmailTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Correo electr\u00f3nico"
          placeholderTextColor="#6F735E"
          className="text-[#242B12]"
          style={{
            fontSize: metrics.formFieldFontSize,
            paddingVertical: metrics.formFieldVerticalPadding,
            paddingHorizontal: metrics.formFieldHorizontalPadding,
          }}
        />
      </View>

      <View className="items-center" style={{ paddingTop: showEmailError ? 6 : 0 }}>
        <InputErrorText
          visible={showEmailError}
          text="Ingresa un correo v\u00e1lido (ejemplo@dominio.com)."
          className="font-inter-medium text-[#D8D98B]"
          style={{ fontSize: metrics.formErrorFontSize, textAlign: 'center' }}
        />
      </View>
    </View>
  );
}
