import { Text, TextInput, View } from 'react-native';
import type { CookingSkill } from '@/features/auth/types/auth';
import {
  COOKING_SKILL_LABELS,
  COOKING_SKILLS,
} from '@/features/preferences/constants/onboardingOptions';
import { OnboardingChip } from '@/features/preferences/components/onboarding/OnboardingChip';
import {
  FieldLabel,
  inputStyle,
  OnboardingSectionCard,
  type OnboardingTheme,
} from '@/features/preferences/components/onboarding/OnboardingSectionCard';

interface HouseholdSectionProps {
  cookingSkill: CookingSkill;
  displayName: string;
  householdSize: string;
  householdSizeNumber: number | null;
  onCookingSkillChange: (skill: CookingSkill) => void;
  onDisplayNameChange: (value: string) => void;
  onHouseholdSizeChange: (value: string) => void;
  theme: OnboardingTheme;
}

export function HouseholdSection({
  cookingSkill,
  displayName,
  householdSize,
  householdSizeNumber,
  onCookingSkillChange,
  onDisplayNameChange,
  onHouseholdSizeChange,
  theme,
}: HouseholdSectionProps) {
  return (
    <OnboardingSectionCard
      kicker="Primero lo importante"
      subtitle="La IA necesita contexto humano antes de sugerir recetas. Esto evita planes genéricos."
      theme={theme}
      title="Tu hogar">
      <View style={{ gap: 12 }}>
        <FieldLabel theme={theme} text="Nombre para mostrar" />
        <TextInput
          accessibilityLabel="displayName"
          value={displayName}
          onChangeText={onDisplayNameChange}
          maxLength={60}
          placeholder="Cómo te llamamos"
          placeholderTextColor="rgba(237, 232, 213, 0.58)"
          style={inputStyle(theme)}
        />

        <FieldLabel theme={theme} text="Personas en casa" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            accessibilityLabel="householdSize"
            value={householdSize}
            onChangeText={(text) => onHouseholdSizeChange(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="1-20"
            placeholderTextColor="rgba(237, 232, 213, 0.58)"
            style={[inputStyle(theme), { flex: 1 }]}
          />
          <View
            style={{
              alignItems: 'center',
              backgroundColor: theme.icon,
              borderRadius: 24,
              justifyContent: 'center',
              minWidth: 96,
              paddingHorizontal: 14,
            }}>
            <Text
              style={{
                color: theme.colorDark,
                fontFamily: 'Montserrat_700Bold',
                fontSize: 21,
                lineHeight: 28,
              }}>
              {householdSizeNumber ?? '—'}
            </Text>
            <Text style={{ color: theme.colorMedium, fontFamily: 'Inter_500Medium', fontSize: 11 }}>
              comensales
            </Text>
          </View>
        </View>

        <FieldLabel theme={theme} text="Tu experiencia cocinando" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {COOKING_SKILLS.map((skill) => (
            <OnboardingChip
              key={skill}
              label={COOKING_SKILL_LABELS[skill]}
              selected={cookingSkill === skill}
              onPress={() => onCookingSkillChange(skill)}
              theme={theme}
            />
          ))}
        </View>
      </View>
    </OnboardingSectionCard>
  );
}
