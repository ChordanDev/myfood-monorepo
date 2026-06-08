import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMealPlanStore } from '@/store';
import { SafeAreaContent, NoisyBackground, ShadowSurface } from '@/components';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRecipeTheme } from '../hooks/useRecipeTheme';
import { getRecipeImageSource } from '../utils/recipeImageSource';

export function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getRecipeById, entries, markAsCooked } = useMealPlanStore();

  const recipe = getRecipeById(id as string);
  const mealEntry = entries.find((e) => e.recipeId === id);
  const theme = useRecipeTheme(recipe);
  const recipeImageSource = getRecipeImageSource(recipe?.imageUrl);
  const previousBackgroundRef = useRef(theme.background);
  const [previousBackground, setPreviousBackground] = useState(theme.background);
  const themeTransitionProgress = useSharedValue(1);

  const animatedThemeStyle = useAnimatedStyle(() => ({
    opacity: themeTransitionProgress.value,
  }));

  useEffect(() => {
    const previousBackgroundValue = previousBackgroundRef.current;
    const nextBackground = theme.background;
    const hasBackgroundChanged =
      previousBackgroundValue[0] !== nextBackground[0] ||
      previousBackgroundValue[1] !== nextBackground[1];

    if (!hasBackgroundChanged) return;

    setPreviousBackground(previousBackgroundValue);
    previousBackgroundRef.current = nextBackground;
    themeTransitionProgress.value = 0;
    themeTransitionProgress.value = withTiming(1, {
      duration: 450,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [theme.background, themeTransitionProgress]);

  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);

  if (!recipe) {
    return (
      <View style={styles.center}>
        <Text style={{ color: 'white' }}>Receta no encontrada</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#FFB63C', marginTop: 10 }}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const handleMarkAsCooked = () => {
    if (mealEntry) {
      markAsCooked(mealEntry.id);
      router.back();
    }
  };

  const handleSendChat = () => {
    if (!chatMessage.trim()) return;
    setChatHistory((prev) => [...prev, { role: 'user', text: chatMessage }]);
    setChatMessage('');
    // Simulamos respuesta de IA
    setTimeout(() => {
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'ai',
          text: `¡Claro! Respecto a "${recipe.name}", mi consejo es que ${chatMessage.includes('pollo') ? 'puedes sustituirlo por tofu si prefieres algo más ligero.' : 'sigas los pasos con cuidado, especialmente el fuego medio.'}`,
        },
      ]);
    }, 1000);
  };

  return (
    <View className="flex-1" style={[styles.screen, { backgroundColor: theme.background[1] }]}>
      <LinearGradient colors={previousBackground} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, animatedThemeStyle]}>
        <LinearGradient colors={theme.background} style={styles.backgroundGradient} />
      </Animated.View>
      <NoisyBackground opacity={0.15} />
      <SafeAreaContent includeBottom={false}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}>
          {/* Header con Imagen */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={{ color: theme.text, fontSize: 24 }}>←</Text>
            </Pressable>
            {recipeImageSource && <Image source={recipeImageSource} style={styles.recipeImage} />}
            <View style={styles.titleOverlay}>
              <Text style={[styles.title, { color: theme.text }]}>{recipe.name.toUpperCase()}</Text>
              <View style={styles.tagContainer}>
                {recipe.tags.map((tag) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: theme.accent }]}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.content}>
            <Text style={[styles.description, { color: theme.secondary }]}>
              {recipe.description}
            </Text>

            {/* Sección Ingredientes */}
            <ShadowSurface style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.accent }]}>INGREDIENTES</Text>
              {recipe.ingredients.map((ing, index) => (
                <View key={index} style={styles.ingredientRow}>
                  <Text style={[styles.dot, { color: theme.accent }]}>•</Text>
                  <Text style={[styles.ingredientText, { color: theme.text }]}>
                    {ing.amount}g de ingrediente {ing.ingredientId}
                  </Text>
                </View>
              ))}
            </ShadowSurface>

            {/* Sección Pasos */}
            <ShadowSurface style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.accent }]}>PREPARACIÓN</Text>
              {recipe.steps.map((step) => (
                <View key={step.order} style={styles.stepRow}>
                  <View style={[styles.stepNumberBadge, { backgroundColor: theme.accent }]}>
                    <Text style={styles.stepNumber}>{step.order}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: theme.text }]}>{step.instruction}</Text>
                </View>
              ))}
            </ShadowSurface>

            {/* Chat de IA */}
            <ShadowSurface style={styles.chatCard}>
              <Text style={[styles.sectionTitle, { color: theme.accent }]}>
                ASISTENTE DE COCINA
              </Text>
              <View style={styles.chatHistory}>
                {chatHistory.length === 0 ? (
                  <Text style={styles.emptyChat}>
                    Hazme cualquier pregunta sobre esta receta...
                  </Text>
                ) : (
                  chatHistory.map((msg, i) => (
                    <View
                      key={i}
                      style={[
                        styles.chatBubble,
                        msg.role === 'user' ? styles.userBubble : styles.aiBubble,
                      ]}>
                      <Text style={styles.chatBubbleText}>{msg.text}</Text>
                    </View>
                  ))
                )}
              </View>
              <View style={styles.chatInputContainer}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Pregunta algo..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  value={chatMessage}
                  onChangeText={setChatMessage}
                />
                <Pressable
                  onPress={handleSendChat}
                  style={[styles.sendButton, { backgroundColor: theme.accent }]}>
                  <Text style={styles.sendButtonText}>→</Text>
                </Pressable>
              </View>
            </ShadowSurface>

            {/* Botón Acción Final */}
            <Pressable
              onPress={handleMarkAsCooked}
              disabled={mealEntry?.isCooked}
              style={[
                styles.mainButton,
                { backgroundColor: mealEntry?.isCooked ? '#444' : theme.accent },
              ]}>
              <Text style={[styles.mainButtonText, { color: theme.primary }]}>
                {mealEntry?.isCooked ? 'PLATILLO COMPLETADO' : 'MARCAR COMO COCINADO'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaContent>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1B210E' },
  screen: { flex: 1 },
  backgroundGradient: { flex: 1 },
  scrollContainer: { paddingBottom: 60 },
  header: { height: 300, width: '100%', position: 'relative' },
  recipeImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  title: { fontSize: 24, fontWeight: 'bold', letterSpacing: 1 },
  tagContainer: { flexDirection: 'row', marginTop: 8, gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagText: { fontSize: 10, fontWeight: 'bold', color: '#1B210E' },
  content: { padding: 20, gap: 20 },
  description: { fontSize: 16, fontStyle: 'italic', marginBottom: 10, lineHeight: 22 },
  card: { padding: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, gap: 15 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', letterSpacing: 2, marginBottom: 5 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { fontSize: 20 },
  ingredientText: { fontSize: 16, opacity: 0.9 },
  stepRow: { flexDirection: 'row', gap: 15, marginBottom: 10 },
  stepNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { fontSize: 12, fontWeight: 'bold', color: '#1B210E' },
  stepText: { fontSize: 16, flex: 1, lineHeight: 22 },
  chatCard: { padding: 20, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 20, gap: 15 },
  chatHistory: { minHeight: 100, gap: 10, marginBottom: 10 },
  emptyChat: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 20 },
  chatBubble: { padding: 12, borderRadius: 15, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: 'rgba(255,255,255,0.1)' },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: 'rgba(216, 217, 139, 0.1)' },
  chatBubbleText: { color: '#F5F3D4', fontSize: 14 },
  chatInputContainer: { flexDirection: 'row', gap: 10 },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 15,
    color: 'white',
    height: 45,
  },
  sendButton: {
    width: 45,
    height: 45,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: { fontSize: 20, fontWeight: 'bold', color: '#1B210E' },
  mainButton: { padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 10 },
  mainButtonText: { fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
});
