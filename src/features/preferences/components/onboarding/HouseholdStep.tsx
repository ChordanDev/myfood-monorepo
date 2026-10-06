import { useRef } from 'react';
import { TextInput, View } from 'react-native';
import type { CookingSkill } from '@/features/auth/types/auth';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import {
  COOKING_SKILL_LABELS,
  COOKING_SKILLS,
} from '@/features/preferences/constants/onboardingOptions';
import { MAX_DISPLAY_NAME_LENGTH } from '@/features/preferences/utils/onboardingSteps';
import { HouseholdSizeStepper } from '@/features/preferences/components/onboarding/HouseholdSizeStepper';
import { OnboardingChoiceChip } from '@/features/preferences/components/onboarding/OnboardingChoiceChip';
import { OnboardingField } from '@/features/preferences/components/onboarding/OnboardingField';

interface HouseholdStepProps {
  cookingSkill: CookingSkill;
  displayName: string;
  householdSize: number;
  onCookingSkillChange: (skill: CookingSkill) => void;
  onDisplayNameChange: (value: string) => void;
  onHouseholdSizeChange: (value: number) => void;
  theme: RecipeThemeConfig;
}

// Step 1, "Tu hogar": who is cooking and for how many.
export function HouseholdStep({
  cookingSkill,
  displayName,
  householdSize,
  onCookingSkillChange,
  onDisplayNameChange,
  onHouseholdSizeChange,
  theme,
}: HouseholdStepProps) {
  const nameInputRef = useRef<TextInput>(null);

  return (
    <View style={{ gap: 14 }}>
      <OnboardingField
        label="Nombre para mostrar"
        onPress={() => nameInputRef.current?.focus()}
        theme={theme}>
        <TextInput
          ref={nameInputRef}
          accessibilityLabel="Nombre para mostrar"
          autoCapitalize="words"
          autoComplete="name"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onChangeText={onDisplayNameChange}
          placeholder="Cómo te llamamos"
          placeholderTextColor={withOpacity(theme.textBlack, 0.45)}
          returnKeyType="done"
          selectionColor={theme.colorDark}
          style={{
            color: theme.textBlack,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 20,
            padding: 0,
          }}
          textContentType="name"
          value={displayName}
        />
      </OnboardingField>

      <OnboardingField label="Personas en casa" theme={theme}>
        <HouseholdSizeStepper
          onChange={onHouseholdSizeChange}
          theme={theme}
          value={householdSize}
        />
      </OnboardingField>

      <OnboardingField
        accessibilityRole="radiogroup"
        label="Tu experiencia cocinando"
        theme={theme}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {COOKING_SKILLS.map((skill) => (
            <OnboardingChoiceChip
              key={skill}
              label={COOKING_SKILL_LABELS[skill]}
              onPress={() => onCookingSkillChange(skill)}
              selected={cookingSkill === skill}
              theme={theme}
            />
          ))}
        </View>
      </OnboardingField>
    </View>
  );
}
