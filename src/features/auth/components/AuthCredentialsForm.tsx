import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

const EMAIL_MAX_LENGTH = 80;
const PASSWORD_MAX_LENGTH = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthCredentialsFormProps {
  metrics: AuthLandingMetrics;
  onValidityChange?: (isValid: boolean) => void;
  onCredentialsChange?: (credentials: { email: string; password: string }) => void;
}

export function AuthCredentialsForm({
  metrics,
  onValidityChange,
  onCredentialsChange,
}: AuthCredentialsFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const isValidEmail = EMAIL_REGEX.test(normalizedEmail);
  const isPasswordValid = password.length > 0 && password.length <= PASSWORD_MAX_LENGTH;
  const isFormValid = isValidEmail && isPasswordValid;
  const showEmailError = emailTouched && email.length > 0 && !isValidEmail;

  useEffect(() => {
    onValidityChange?.(isFormValid);
    onCredentialsChange?.({ email: normalizedEmail, password });
  }, [isFormValid, normalizedEmail, onCredentialsChange, onValidityChange, password]);

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

        <View
          className="self-center bg-[#8E9279]"
          style={{
            height: 1,
            width: metrics.formFieldSeparatorWidth,
            opacity: 0.8,
          }}
        />

        <View>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Contraseña"
            placeholderTextColor="#6F735E"
            secureTextEntry={!showPassword}
            maxLength={PASSWORD_MAX_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            className="text-[#242B12]"
            style={{
              fontSize: metrics.formFieldFontSize,
              paddingVertical: metrics.formFieldVerticalPadding,
              paddingLeft: metrics.formFieldHorizontalPadding,
              paddingRight: metrics.formFieldHorizontalPadding + 36,
            }}
          />
          <Pressable
            onPress={() => setShowPassword((prev) => !prev)}
            className="absolute right-0"
            style={{
              height: '100%',
              justifyContent: 'center',
              paddingHorizontal: metrics.formFieldHorizontalPadding,
            }}>
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={metrics.formFieldFontSize + 4}
              color="#4A5135"
            />
          </Pressable>
        </View>
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
