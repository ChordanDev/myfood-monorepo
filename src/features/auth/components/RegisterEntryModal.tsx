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

interface RegisterEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onContinue: (email: string) => void;
}

export function RegisterEntryModal({ visible, onClose, onContinue }: RegisterEntryModalProps) {
  const { width, height } = useWindowDimensions();
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
          style={[inputAnimatedStyle, { maxHeight: modalMaxHeight }]}
          className="w-full max-w-[440px] overflow-hidden rounded-3xl bg-[#E5D8C4]">
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 }}>
            <Text className="text-center font-montserrat-bold text-xl text-[#242B12]">
              Creá tu cuenta
            </Text>
            <Text className="font-inter-regular mt-2 text-center text-[#4A5130]">
              Ingresá tu correo y acepta los términos para recibir un código de verificación.
            </Text>

            <View className="mt-5 rounded-xl bg-[#F6ECDE]">
              <EmailTextInput
                value={registerEmail}
                onChangeText={setRegisterEmail}
                placeholder="tuemail@dominio.com"
                placeholderTextColor="#6F735E"
                androidDescenderFix
                className="font-inter-regular px-4 text-[#242B12]"
                style={{
                  fontSize: 14,
                  height: 48,
                  ...(Platform.OS === 'ios' ? { paddingTop: 12, paddingBottom: 12 } : null),
                }}
              />
            </View>

            <InputErrorText
              visible={showEmailError}
              text="Ingresa un correo v\u00e1lido para continuar."
              className="mt-2 font-inter-medium text-sm text-[#8A1F1F]"
            />

            <Pressable
              className="mt-4 flex-row items-center"
              onPress={() => setAcceptedTerms((prev) => !prev)}>
              <View
                className={`h-6 w-6 items-center justify-center rounded-md border ${
                  acceptedTerms ? 'border-[#242B12] bg-[#242B12]' : 'border-[#6F735E]'
                }`}>
                {acceptedTerms ? <Text className="text-xs text-[#E5D8C4]">✓</Text> : null}
              </View>
              <Text className="font-inter-regular ml-3 flex-1 text-[#242B12]">
                Acepto términos y condiciones.
              </Text>
            </Pressable>

            <InputErrorText
              visible={termsTouched && isValidRegisterEmail && !acceptedTerms}
              text="Debes aceptar los términos para crear tu cuenta."
              className="mt-2 font-inter-medium text-sm text-[#8A1F1F]"
            />

            <View className="mt-6">
              <Pressable
                onPress={handleContinue}
                disabled={isContinueDisabled}
                className="w-full items-center rounded-2xl bg-[#242B12] py-3 active:opacity-90"
                style={{ opacity: canSubmit ? 1 : 0.55 }}>
                <Text className="font-inter-semibold text-base text-[#D8D98B]">Continuar</Text>
              </Pressable>

              <Pressable onPress={handleClose} className="mt-3 items-center py-1">
                <Text className="font-inter-medium text-sm text-[#4A5130]">Cancelar</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
