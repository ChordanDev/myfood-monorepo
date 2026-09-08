import { Platform, TextInput, TextInputProps } from 'react-native';
import { EMAIL_MAX_LENGTH } from '../hooks';

interface EmailTextInputProps extends Omit<
  TextInputProps,
  'keyboardType' | 'autoCapitalize' | 'autoCorrect' | 'maxLength' | 'value' | 'onChangeText'
> {
  value: string;
  onChangeText: (value: string) => void;
  androidDescenderFix?: boolean;
}

export function EmailTextInput({
  value,
  onChangeText,
  androidDescenderFix = false,
  style,
  ...rest
}: EmailTextInputProps) {
  return (
    <TextInput
      // Forza configuracion adecuada para emails.
      value={value}
      onChangeText={onChangeText}
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={EMAIL_MAX_LENGTH}
      textAlignVertical={androidDescenderFix ? 'center' : rest.textAlignVertical}
      style={[
        { letterSpacing: 0 },
        style,
        androidDescenderFix && Platform.OS === 'android'
          ? { paddingTop: 0, paddingBottom: 0, includeFontPadding: true }
          : null,
      ]}
      {...rest}
    />
  );
}
