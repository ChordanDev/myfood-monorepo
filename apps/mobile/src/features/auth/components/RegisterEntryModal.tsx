import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Platform,
  StyleSheet,
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
  isSubmitting?: boolean;
  onClose: () => void;
  onContinue: (email: string) => void;
}

export function RegisterEntryModal({
  visible,
  isSubmitting = false,
  onClose,
  onContinue,
}: RegisterEntryModalProps) {
  const { width, height } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const { getColorWithOpacity } = useThemeColor();
  const { inputAnimatedStyle } = useKeyboardAnimation({
    mode: 'proportional',
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
  const isContinueDisabled = !canSubmit || isSubmitting;
  const showEmailError = registerEmail.length > 0 && !isValidRegisterEmail;

  const handleClose = () => {
    // Reinicia validacion de terminos al cerrar.
    setTermsTouched(false);
    onClose();
  };

  const handleContinue = () => {
    // Muestra error de terminos si intenta continuar sin aceptar.
    setTermsTouched(true);

    if (!canSubmit || isSubmitting) {
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
      <View style={[styles.backdrop, { paddingHorizontal: modalHorizontalPadding }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />

        <Animated.View
          style={[
            styles.modal,
            inputAnimatedStyle,
            { maxHeight: modalMaxHeight, backgroundColor: theme.icon },
          ]}>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 }}>
            <Text style={[styles.title, { color: theme.colorMedium }]}>Creá tu cuenta</Text>
            <Text style={[styles.subtitle, { color: theme.textMedium }]}>
              Ingresá tu correo y acepta los términos para recibir un código de verificación.
            </Text>

            <View
              style={[
                styles.emailContainer,
                { backgroundColor: getColorWithOpacity('icon', 0.8) },
              ]}>
              <EmailTextInput
                value={registerEmail}
                onChangeText={setRegisterEmail}
                placeholder="tuemail@dominio.com"
                placeholderTextColor={theme.textLight}
                androidDescenderFix
                style={{
                  color: theme.textBlack,
                  fontFamily: 'Inter_400Regular',
                  fontSize: 14,
                  height: 48,
                  paddingHorizontal: 14,
                  ...(Platform.OS === 'ios' ? { paddingTop: 12, paddingBottom: 12 } : null),
                }}
              />
            </View>

            <InputErrorText
              visible={showEmailError}
              text="Ingresa un correo v\u00e1lido para continuar."
              style={{ color: theme.primaryAccentIntense, marginTop: 7 }}
            />

            <Pressable onPress={() => setAcceptedTerms((prev) => !prev)} style={styles.termsRow}>
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: acceptedTerms ? theme.colorMedium : theme.textLight,
                    backgroundColor: acceptedTerms ? theme.colorMedium : 'transparent',
                  },
                ]}>
                {acceptedTerms ? (
                  <Text style={[styles.checkmark, { color: theme.icon }]}>✓</Text>
                ) : null}
              </View>
              <Text style={[styles.termsLabel, { color: theme.colorMedium }]}>
                Acepto términos y condiciones.
              </Text>
            </Pressable>

            <InputErrorText
              visible={termsTouched && isValidRegisterEmail && !acceptedTerms}
              text="Debes aceptar los términos para crear tu cuenta."
              style={{ color: theme.primaryAccentIntense, marginTop: 7 }}
            />

            <View style={styles.actions}>
              <Pressable
                onPress={handleContinue}
                disabled={isContinueDisabled}
                style={({ pressed }) => [
                  styles.continueButton,
                  {
                    backgroundColor: theme.colorMedium,
                    opacity: isContinueDisabled ? 0.55 : pressed ? 0.9 : 1,
                  },
                ]}>
                <Text style={[styles.continueLabel, { color: theme.primaryAccent }]}>
                  {isSubmitting ? 'Enviando código...' : 'Continuar'}
                </Text>
              </Pressable>

              <Pressable disabled={isSubmitting} onPress={handleClose} style={styles.cancelButton}>
                <Text style={[styles.cancelLabel, { color: theme.textMedium }]}>Cancelar</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    marginTop: 21,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
  },
  cancelButton: {
    alignItems: 'center',
    marginTop: 10.5,
    paddingVertical: 3.5,
  },
  cancelLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 5.25,
    borderWidth: 1,
    height: 21,
    justifyContent: 'center',
    width: 21,
  },
  checkmark: {
    fontSize: 10.5,
    lineHeight: 14,
  },
  continueButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 10.5,
    width: '100%',
  },
  continueLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
  },
  emailContainer: {
    borderRadius: 10.5,
    marginTop: 17.5,
  },
  modal: {
    borderRadius: 21,
    maxWidth: 440,
    overflow: 'hidden',
    width: '100%',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    marginTop: 7,
    textAlign: 'center',
  },
  termsLabel: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    marginLeft: 10.5,
  },
  termsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 14,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 17.5,
    lineHeight: 24.5,
    textAlign: 'center',
  },
});
