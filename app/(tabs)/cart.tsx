import { Text, View } from 'react-native';

export default function CartRoute() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#111309',
      }}>
      <Text style={{ color: '#F5F5F5' }}>Carrito</Text>
    </View>
  );
}
