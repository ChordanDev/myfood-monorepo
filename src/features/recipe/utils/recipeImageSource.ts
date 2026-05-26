import type { ImageSourcePropType } from 'react-native';

const LOCAL_RECIPE_IMAGE_ASSETS: Record<string, ImageSourcePropType> = {
  'Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png': require('../../../../assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png'),
};

export function getRecipeImageSource(imageUrl?: string | null): ImageSourcePropType | null {
  if (!imageUrl) return null;

  const fileName = imageUrl.split('/').pop();
  if (fileName && LOCAL_RECIPE_IMAGE_ASSETS[fileName]) {
    return LOCAL_RECIPE_IMAGE_ASSETS[fileName];
  }

  if (/^(https?:|file:|content:|asset:)/.test(imageUrl)) {
    return { uri: imageUrl };
  }

  return null;
}
