import { Text, View, Pressable } from 'react-native';
import { useAuth } from '../../src/features/auth';
import { COLORS } from '../../src/constants/theme';

export default function ProfileRoute() {
  const { signOut, user } = useAuth();

  return (
    <View
      className="flex-1 items-center justify-center px-6"
      style={{ backgroundColor: COLORS.bgDarkest }}>
      <Text style={{ color: COLORS.textLight }} className="mb-2 font-inter-medium text-base">
        Perfil
      </Text>

      {user && (
        <Text
          style={{ color: COLORS.accentGreenMuted }}
          className="font-inter-regular mb-8 text-sm">
          {user.email}
        </Text>
      )}

      <Pressable
        onPress={signOut}
        className="w-full max-w-[200px] items-center rounded-2xl py-3 active:opacity-80"
        style={{ backgroundColor: COLORS.textError }}>
        <Text className="font-inter-semibold text-base" style={{ color: COLORS.textLight }}>
          Cerrar Sesión
        </Text>
      </Pressable>
    </View>
  );
}
