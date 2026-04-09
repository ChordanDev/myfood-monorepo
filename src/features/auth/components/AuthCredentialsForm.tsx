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
  const [email, setEmail] = useState('');

  const { normalizedEmail, isValidEmail } = useEmailValidation(email);
  const isFormValid = isValidEmail;
  const showEmailError = email.length > 0 && !isValidEmail;

  useEffect(() => {
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
          placeholder="Correo electronico"
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
          text="Ingresa un correo valido (ejemplo@dominio.com)."
          className="font-inter-medium text-[#D8D98B]"
          style={{ fontSize: metrics.formErrorFontSize, textAlign: 'center' }}
        />
      </View>
    </View>
  );
}
