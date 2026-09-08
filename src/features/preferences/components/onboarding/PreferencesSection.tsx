import { Text, TextInput, View } from 'react-native';
import {
  DIET_CODES,
  DIET_LABELS,
  HARD_RESTRICTION_CODES,
  HARD_RESTRICTION_LABELS,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';
import { OnboardingChip } from '@/features/preferences/components/onboarding/OnboardingChip';
import {
  FieldLabel,
  inputStyle,
  OnboardingSectionCard,
  type OnboardingTheme,
} from '@/features/preferences/components/onboarding/OnboardingSectionCard';

interface PreferencesSectionProps {
  diet: DietCode | null;
  hardRestrictions: HardRestrictionCode[];
  onDietChange: (diet: DietCode | null) => void;
  onSoftPreferencesChange: (value: string) => void;
  onToggleHardRestriction: (code: HardRestrictionCode) => void;
  softPreferences: string;
  theme: OnboardingTheme;
}

export function PreferencesSection({
  diet,
  hardRestrictions,
  onDietChange,
  onSoftPreferencesChange,
  onToggleHardRestriction,
  softPreferences,
  theme,
}: PreferencesSectionProps) {
  return (
    <OnboardingSectionCard
      kicker="Después afinamos el gusto"
      subtitle="Separá restricciones reales de preferencias blandas. Esa diferencia es clave para no sugerir mal."
      theme={theme}
      title="Preferencias">
      <FieldLabel theme={theme} text="Dieta" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <OnboardingChip
          key="none"
          label="Ninguna"
          selected={diet === null}
          onPress={() => onDietChange(null)}
          theme={theme}
        />
        {DIET_CODES.map((code) => (
          <OnboardingChip
            key={code}
            label={DIET_LABELS[code]}
            selected={diet === code}
            onPress={() => onDietChange(code)}
            theme={theme}
          />
        ))}
      </View>

      <View style={{ gap: 6 }}>
        <FieldLabel theme={theme} text="Restricciones duras" />
        <Text
          style={{
            color: theme.colorMedium,
            fontFamily: 'Inter_400Regular',
            fontSize: 10.5,
            lineHeight: 14,
          }}>
          Tocá solo lo que no se puede negociar.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {HARD_RESTRICTION_CODES.map((code) => (
          <OnboardingChip
            key={code}
            label={HARD_RESTRICTION_LABELS[code]}
            selected={hardRestrictions.includes(code)}
            onPress={() => onToggleHardRestriction(code)}
            theme={theme}
          />
        ))}
      </View>

      <FieldLabel theme={theme} text="Preferencias suaves (separadas por coma)" />
      <TextInput
        accessibilityLabel="softPreferences"
        value={softPreferences}
        onChangeText={onSoftPreferencesChange}
        placeholder="ej. cilantro, picante, comidas rápidas"
        placeholderTextColor="rgba(237, 232, 213, 0.58)"
        style={inputStyle(theme)}
      />
    </OnboardingSectionCard>
  );
}
