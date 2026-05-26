import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Platform,
  useWindowDimensions,
} from 'react-native';

import Animated from 'react-native-reanimated';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { useEmailValidation } from '../hooks';
import { EmailTextInput } from './EmailTextInput';
import { InputErrorText } from './InputErrorText';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';

interface RegisterEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onContinue: (email: string) => void;
}

export function RegisterEntryModal({ visible, onClose, onContinue }: RegisterEntryModalProps) {
  const { width, height } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const { getColorWithOpacity } = useThemeColor();
  const { inputAnimatedStyle } = useKeyboardAnimation({
    enabled: visible,
    liftFactor: Platform.OS === 'android' ? 0.3 : 0.3,
    durationScale: 1.2,
  });
  const [registerEmail, setRegisterEmail] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsTouched, setTermsTouched] = useState(false);

  const modalHorizontalPadding = width < 360 ? 16 : 24;
  const modalMaxHeight = Math.min(height * 0.82, 560);

  const { normalizedEmail: normalizedRegisterEmail, isValidEmail: isValidRegisterEmail } =
    useEmailValidation(registerEmail);
  const canSubmit = isValidRegisterEmail && acceptedTerms;
  const isContinueDisabled = !canSubmit;
  const showEmailError = registerEmail.length > 0 && !isValidRegisterEmail;

  const handleClose = () => {
    // Reinicia validacion de terminos al cerrar.
    setTermsTouched(false);
    onClose();
  };

  const handleContinue = () => {
    // Muestra error de terminos si intenta continuar sin aceptar.
    setTermsTouched(true);

    if (!canSubmit) {
      return;
    }

    onContinue(normalizedRegisterEmail);
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={handleClose}
      statusBarTranslucent>
      <View
        className="flex-1 items-center justify-center bg-black/60"
        style={{ paddingHorizontal: modalHorizontalPadding }}>
        <Pressable className="absolute inset-0" onPress={handleClose} />

        <Animated.View
          style={[inputAnimatedStyle, { maxHeight: modalMaxHeight, backgroundColor: theme.icon }]}
          className="w-full max-w-[440px] overflow-hidden rounded-3xl">
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 }}>
            <Text
              className="text-center font-montserrat-bold text-xl"
              style={{ color: theme.colorMedium }}>
              Creá tu cuenta
            </Text>
            <Text
              className="font-inter-regular mt-2 text-center"
              style={{ color: theme.textMedium }}>
              Ingresá tu correo y acepta los términos para recibir un código de verificación.
            </Text>

            <View
              className="mt-5 rounded-xl"
              style={{ backgroundColor: getColorWithOpacity('icon', 0.8) }}>
              <EmailTextInput
                value={registerEmail}
                onChangeText={setRegisterEmail}
                placeholder="tuemail@dominio.com"
                placeholderTextColor={theme.textLight}
                androidDescenderFix
                className="font-inter-regular px-4"
                style={{
                  color: theme.textBlack,
                  fontSize: 14,
                  height: 48,
                  ...(Platform.OS === 'ios' ? { paddingTop: 12, paddingBottom: 12 } : null),
                }}
              />
            </View>

            <InputErrorText
              visible={showEmailError}
              text="Ingresa un correo v\u00e1lido para continuar."
              className="mt-2 font-inter-medium text-sm"
              style={{ color: theme.primaryAccentIntense }}
            />

            <Pressable
              className="mt-4 flex-row items-center"
              onPress={() => setAcceptedTerms((prev) => !prev)}>
              <View
                className="h-6 w-6 items-center justify-center rounded-md border"
                style={{
                  borderColor: acceptedTerms ? theme.colorMedium : theme.textLight,
                  backgroundColor: acceptedTerms ? theme.colorMedium : 'transparent',
                }}>
                {acceptedTerms ? (
                  <Text className="text-xs" style={{ color: theme.icon }}>
                    ✓
                  </Text>
                ) : null}
              </View>
              <Text className="font-inter-regular ml-3 flex-1" style={{ color: theme.colorMedium }}>
                Acepto términos y condiciones.
              </Text>
            </Pressable>

            <InputErrorText
              visible={termsTouched && isValidRegisterEmail && !acceptedTerms}
              text="Debes aceptar los términos para crear tu cuenta."
              className="mt-2 font-inter-medium text-sm"
              style={{ color: theme.primaryAccentIntense }}
            />

            <View className="mt-6">
              <Pressable
                onPress={handleContinue}
                disabled={isContinueDisabled}
                className="w-full items-center rounded-2xl py-3 active:opacity-90"
                style={{ backgroundColor: theme.colorMedium, opacity: canSubmit ? 1 : 0.55 }}>
                <Text
                  className="font-inter-semibold text-base"
                  style={{ color: theme.primaryAccent }}>
                  Continuar
                </Text>
              </Pressable>

              <Pressable onPress={handleClose} className="mt-3 items-center py-1">
                <Text className="font-inter-medium text-sm" style={{ color: theme.textMedium }}>
                  Cancelar
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
