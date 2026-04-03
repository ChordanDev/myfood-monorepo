import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

const EMAIL_MAX_LENGTH = 80;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [emailTouched, setEmailTouched] = useState(false);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const isValidEmail = EMAIL_REGEX.test(normalizedEmail);
  const isFormValid = isValidEmail;
  const showEmailError = emailTouched && email.length > 0 && !isValidEmail;

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
        <TextInput
          value={email}
          onChangeText={setEmail}
          onBlur={() => setEmailTouched(true)}
          placeholder="Correo electronico"
          placeholderTextColor="#6F735E"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={EMAIL_MAX_LENGTH}
          className="text-[#242B12]"
          style={{
            fontSize: metrics.formFieldFontSize,
            paddingVertical: metrics.formFieldVerticalPadding,
            paddingHorizontal: metrics.formFieldHorizontalPadding,
          }}
        />
      </View>

      <View className="items-center" style={{ paddingTop: showEmailError ? 6 : 0 }}>
        {showEmailError ? (
          <Text
            style={{ fontSize: metrics.formErrorFontSize, textAlign: 'center' }}
            className="font-inter-medium text-[#D8D98B]">
            Ingresa un correo valido (ejemplo@dominio.com).
          </Text>
        ) : null}
      </View>
    </View>
  );
}
