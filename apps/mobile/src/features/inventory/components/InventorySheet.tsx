import { useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthErrorMessage } from '@/api/errors';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { withOpacity } from '@/utils/colors';

const MAX_HEIGHT_RATIO = 0.85;

type SheetWrite = 'submit' | 'secondary';

/**
 * What a sheet that writes to the API keeps for one opening. The writes are online only: the
 * sheet waits for the answer, closes on success and stays open with the message of the error
 * otherwise. Nothing can be written twice or left behind by closing while one is on its way.
 */
export function useInventorySheetWrite(visible: boolean, onClose: () => void) {
  const [opening, setOpening] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  const [pending, setPending] = useState<SheetWrite | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // A ref, not state: two presses can land before the first one has re-rendered anything.
  const isWritingRef = useRef(false);

  // Every opening starts over: the form is keyed by `opening`. It is kept on close so it does
  // not empty while the sheet fades out.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setOpening((current) => current + 1);
      setErrorMessage(null);
    }
  }

  // `closeWhen` lets a multi-step sheet stay open on a success that is not its last step.
  const run = async <T,>(
    write: SheetWrite,
    send: () => Promise<T>,
    closeWhen: (result: T) => boolean = () => true
  ) => {
    // The panel stays mounted while it fades out, so a late press could write again.
    if (!visible || isWritingRef.current) return;

    isWritingRef.current = true;
    setPending(write);
    setErrorMessage(null);

    try {
      const result = await send();
      if (closeWhen(result)) onClose();
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      isWritingRef.current = false;
      setPending(null);
    }
  };

  const close = () => {
    if (!isWritingRef.current) onClose();
  };

  return { opening, pending, errorMessage, run, close };
}

interface InventorySheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Bottom sheet of the inventory forms. Mirrors the Home "eat today" sheet.
export function InventorySheet({ visible, onClose, children }: InventorySheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  // The panel rests on the bottom edge of the window, so it rises by the whole keyboard.
  const { inputAnimatedStyle, keyboardLift } = useKeyboardAnimation({
    mode: 'geometry',
    restingBottomOffset: 0,
    bottomInset: insets.bottom,
    enabled: visible,
  });

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              backgroundColor: theme.colorDark,
              // Lifted by the keyboard, the panel still ends under the status bar: the fields
              // scroll in what is left.
              maxHeight: Math.min(height * MAX_HEIGHT_RATIO, height - keyboardLift - insets.top),
              paddingBottom: insets.bottom + 16,
            },
            inputAnimatedStyle,
          ]}>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SheetAction {
  label: string;
  pendingLabel: string;
  onPress: () => void;
}

interface InventorySheetFormProps {
  title: string;
  /** Read-only line under the title. */
  subtitle?: string | null;
  /** The write on its way, if any: every action waits for it. */
  pending: SheetWrite | null;
  /** Failure of the last write, shown above the actions while the sheet stays open. */
  errorMessage: string | null;
  canSubmit: boolean;
  submit: SheetAction;
  secondary?: SheetAction;
  onClose: () => void;
  /** The fields. */
  children: ReactNode;
}

export function InventorySheetForm({
  title,
  subtitle,
  pending,
  errorMessage,
  canSubmit,
  submit,
  secondary,
  onClose,
  children,
}: InventorySheetFormProps) {
  const { theme } = useRecipeTheme();
  const isBusy = pending !== null;
  const isSubmitDisabled = isBusy || !canSubmit;

  return (
    <>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          numberOfLines={3}
          ellipsizeMode="tail"
          style={[styles.subtitle, { color: theme.textMedium }]}>
          {subtitle}
        </Text>
      ) : null}

      <ScrollView
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}>
        {children}
      </ScrollView>

      {errorMessage ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.primaryAccent }]}>
          {errorMessage}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitDisabled, busy: pending === 'submit' }}
          disabled={isSubmitDisabled}
          onPress={submit.onPress}
          style={({ pressed }) => [
            styles.submitButton,
            {
              backgroundColor: theme.primaryAccent,
              borderColor: theme.primaryAccentIntense,
              opacity: isSubmitDisabled ? 0.45 : pressed ? 0.9 : 1,
            },
          ]}>
          {pending === 'submit' ? <ActivityIndicator size="small" color={theme.textBlack} /> : null}
          <Text style={[styles.submitLabel, { color: theme.textBlack }]}>
            {pending === 'submit' ? submit.pendingLabel : submit.label}
          </Text>
        </Pressable>

        {secondary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy, busy: pending === 'secondary' }}
            disabled={isBusy}
            onPress={secondary.onPress}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: withOpacity(theme.icon, 0.3),
                opacity: isBusy ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}>
            <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>
              {pending === 'secondary' ? secondary.pendingLabel : secondary.label}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          onPress={onClose}
          style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>Cancelar</Text>
        </Pressable>
      </View>
    </>
  );
}

interface InventorySheetFieldProps extends TextInputProps {
  label: string;
  /** Text after the input, such as the unit of a quantity. */
  trailing?: string;
}

export function InventorySheetField({ label, trailing, ...inputProps }: InventorySheetFieldProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: theme.textMedium }]}>{label}</Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: withOpacity(theme.icon, 0.15),
            borderColor: withOpacity(theme.icon, 0.3),
          },
        ]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={withOpacity(theme.textLight, 0.6)}
          selectionColor={theme.primaryAccent}
          style={[styles.input, { color: theme.textLight }]}
          {...inputProps}
        />
        {trailing ? (
          <Text style={[styles.trailing, { color: theme.textMedium }]}>{trailing}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 24,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: 20,
  },
  bodyContent: {
    gap: 14,
  },
  error: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  field: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    paddingVertical: 12,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  submitLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  textButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  textButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  trailing: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
});
