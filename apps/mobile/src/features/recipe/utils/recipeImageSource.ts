import type { ImageSourcePropType } from 'react-native';

export function getRecipeImageSource(imageUrl?: string | null): ImageSourcePropType | null {
  if (!imageUrl) return null;

  if (/^(https?:|file:|content:|asset:)/.test(imageUrl)) {
    return { uri: imageUrl };
  }

  return null;
}
