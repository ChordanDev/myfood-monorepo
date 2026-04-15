import { Text, View } from 'react-native';

export default function ProfileRoute() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#111309',
      }}>
      <Text style={{ color: '#F5F5F5' }}>Perfil</Text>
    </View>
  );
}
