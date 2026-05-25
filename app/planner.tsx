import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaContent, NoisyBackground } from '@/components';
import { LinearGradient } from 'expo-linear-gradient';

export default function PlannerScreen() {
  const router = useRouter();

  return (
    <LinearGradient colors={['#364025', '#1B210E']} className="flex-1" style={{ flex: 1 }}>
      <NoisyBackground opacity={0.1} />
      <SafeAreaContent>
        <View style={styles.container}>
          <Text style={styles.title}>AI Planner</Text>
          <Text style={styles.subtitle}>Aquí configuraremos tu próximo plan de comidas.</Text>

          <View style={styles.formPlaceholder}>
            <Text style={styles.label}>Días a planificar: 5</Text>
            <Text style={styles.label}>Presupuesto: Muy Barato</Text>
          </View>

          <Pressable onPress={() => router.back()} style={styles.button}>
            <Text style={styles.buttonText}>Generar Plan (Próximamente...)</Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={{ marginTop: 20 }}>
            <Text style={{ color: '#D8D98B' }}>Cancelar</Text>
          </Pressable>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#F5F3D4', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#D8D98B', textAlign: 'center', marginBottom: 40 },
  formPlaceholder: {
    width: '100%',
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    marginBottom: 30,
  },
  label: { fontSize: 18, color: '#F5F3D4', marginBottom: 10 },
  button: {
    backgroundColor: '#FFB63C',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: { color: '#1B210E', fontWeight: 'bold', fontSize: 18 },
});
