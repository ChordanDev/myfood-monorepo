import { useRef } from 'react';
import { type TextInput, View } from 'react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import {
  DIET_CODES,
  DIET_LABELS,
  HARD_RESTRICTION_CODES,
  HARD_RESTRICTION_LABELS,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';
import { OnboardingChoiceChip } from '@/features/onboarding/components/OnboardingChoiceChip';
import {
  OnboardingField,
  OnboardingFieldHint,
} from '@/features/onboarding/components/OnboardingField';
import { OnboardingTextInput } from '@/features/onboarding/components/OnboardingTextInput';

interface PreferencesStepProps {
  diet: DietCode | null;
  hardRestrictions: HardRestrictionCode[];
  onDietChange: (diet: DietCode | null) => void;
  onSoftPreferencesChange: (value: string) => void;
  onToggleHardRestriction: (code: HardRestrictionCode) => void;
  softPreferences: string;
  theme: RecipeThemeConfig;
}

const chipRowStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const;

// Step 2, "Preferencias": what the household eats and what it cannot eat.
export function PreferencesStep({
  diet,
  hardRestrictions,
  onDietChange,
  onSoftPreferencesChange,
  onToggleHardRestriction,
  softPreferences,
  theme,
}: PreferencesStepProps) {
  const softPreferencesInputRef = useRef<TextInput>(null);

  return (
    <View style={{ gap: 14 }}>
      <OnboardingField accessibilityRole="radiogroup" label="Dieta" theme={theme}>
        <View style={chipRowStyle}>
          <OnboardingChoiceChip
            label="Ninguna"
            onPress={() => onDietChange(null)}
            selected={diet === null}
            theme={theme}
          />
          {DIET_CODES.map((code) => (
            <OnboardingChoiceChip
              key={code}
              label={DIET_LABELS[code]}
              onPress={() => onDietChange(code)}
              selected={diet === code}
              theme={theme}
            />
          ))}
        </View>
      </OnboardingField>

      <OnboardingField label="Restricciones duras" theme={theme}>
        <OnboardingFieldHint text="Tocá solo lo que no se puede negociar." theme={theme} />
        <View style={chipRowStyle}>
          {HARD_RESTRICTION_CODES.map((code) => (
            <OnboardingChoiceChip
              key={code}
              label={HARD_RESTRICTION_LABELS[code]}
              onPress={() => onToggleHardRestriction(code)}
              role="checkbox"
              selected={hardRestrictions.includes(code)}
              theme={theme}
            />
          ))}
        </View>
      </OnboardingField>

      <OnboardingField
        label="Preferencias suaves"
        onPress={() => softPreferencesInputRef.current?.focus()}
        theme={theme}>
        <OnboardingFieldHint text="Opcional. Separalas con comas." theme={theme} />
        <OnboardingTextInput
          ref={softPreferencesInputRef}
          accessibilityLabel="Preferencias suaves"
          autoCapitalize="none"
          onChangeText={onSoftPreferencesChange}
          placeholder="ej. cilantro, picante, comidas rápidas"
          returnKeyType="done"
          style={{ fontSize: 17 }}
          theme={theme}
          value={softPreferences}
        />
      </OnboardingField>
    </View>
  );
}
