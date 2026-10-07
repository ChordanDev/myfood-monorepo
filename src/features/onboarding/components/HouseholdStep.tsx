import { useRef } from 'react';
import { type TextInput, View } from 'react-native';
import type { CookingSkill } from '@/features/auth/types/auth';
import type { RecipeThemeConfig } from '@/types/domain';
import {
  COOKING_SKILL_LABELS,
  COOKING_SKILLS,
} from '@/features/preferences/constants/preferenceOptions';
import { MAX_DISPLAY_NAME_LENGTH } from '@/features/onboarding/utils/onboardingSteps';
import { HouseholdSizeStepper } from '@/features/onboarding/components/HouseholdSizeStepper';
import { OnboardingChoiceChip } from '@/features/onboarding/components/OnboardingChoiceChip';
import { OnboardingField } from '@/features/onboarding/components/OnboardingField';
import { OnboardingTextInput } from '@/features/onboarding/components/OnboardingTextInput';

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
        <OnboardingTextInput
          ref={nameInputRef}
          accessibilityLabel="Nombre para mostrar"
          autoCapitalize="words"
          autoComplete="name"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onChangeText={onDisplayNameChange}
          placeholder="Cómo te llamamos"
          returnKeyType="done"
          textContentType="name"
          theme={theme}
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
