import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterEntryModalProps {
  visible: boolean;
  onClose: () => void;
  onContinue: (email: string) => void;
}

export function RegisterEntryModal({ visible, onClose, onContinue }: RegisterEntryModalProps) {
  const { width, height } = useWindowDimensions();
  const { formAnimatedStyle } = useKeyboardAnimation({
    enabled: visible,
    liftFactor: Platform.OS === 'android' ? 0.3 : 0.3,
    durationScale: 1.2,
  });
  const [registerEmail, setRegisterEmail] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [termsTouched, setTermsTouched] = useState(false);

  const modalHorizontalPadding = width < 360 ? 16 : 24;
  const modalMaxHeight = Math.min(height * 0.82, 560);

  const normalizedRegisterEmail = useMemo(
    () => registerEmail.trim().toLowerCase(),
    [registerEmail]
  );
  const isValidRegisterEmail = EMAIL_REGEX.test(normalizedRegisterEmail);

  const handleClose = () => {
    setEmailTouched(false);
    setTermsTouched(false);
    onClose();
  };

  const handleContinue = () => {
    setEmailTouched(true);
    setTermsTouched(true);

    if (!isValidRegisterEmail || !acceptedTerms) {
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
          style={[formAnimatedStyle, { maxHeight: modalMaxHeight }]}
          className="w-full max-w-[440px] overflow-hidden rounded-3xl bg-[#E5D8C4]">
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 }}>
            <Text className="text-center font-montserrat-bold text-xl text-[#242B12]">
              Crea tu cuenta
            </Text>
            <Text className="font-inter-regular mt-2 text-center text-[#4A5130]">
              Ingresa tu correo y acepta los terminos para recibir un codigo de verificacion.
            </Text>

            <View className="mt-5 rounded-xl bg-[#F6ECDE]">
              <TextInput
                value={registerEmail}
                onChangeText={setRegisterEmail}
                onBlur={() => setEmailTouched(true)}
                placeholder="tuemail@dominio.com"
                placeholderTextColor="#6F735E"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className="font-inter-regular px-4 py-3 text-base text-[#242B12]"
              />
            </View>

            {emailTouched && !isValidRegisterEmail ? (
              <Text className="mt-2 font-inter-medium text-sm text-[#8A1F1F]">
                Ingresa un correo valido para continuar.
              </Text>
            ) : null}

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
                Acepto terminos y condiciones.
              </Text>
            </Pressable>

            {termsTouched && !acceptedTerms ? (
              <Text className="mt-2 font-inter-medium text-sm text-[#8A1F1F]">
                Debes aceptar los terminos para crear tu cuenta.
              </Text>
            ) : null}

            <View className="mt-6">
              <Pressable
                onPress={handleContinue}
                className="w-full items-center rounded-2xl bg-[#242B12] py-3 active:opacity-90">
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
