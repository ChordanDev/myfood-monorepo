import { Image, ImageSourcePropType, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

interface CarouselImagesProps {
  images: ImageSourcePropType[];
  metrics: AuthLandingMetrics;
}

export function CarouselImages({ images, metrics }: CarouselImagesProps) {
  const centerIndex = Math.floor(images.length / 2);

  return (
    <View
      style={{
        height: metrics.carouselHeight,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      {images.map((source, index) => {
        const diff = index - centerIndex;
        const distance = Math.abs(diff);

        const scale =
          diff === 0 ? 1 : distance === 1 ? metrics.carouselSideScale : metrics.carouselEdgeScale;
        const size = metrics.carouselBaseImageSize * scale;
        const translateX = diff * (metrics.screenWidth * metrics.carouselTranslateFactor);

        return (
          <Image
            key={`food-image-${index}`}
            source={source}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size / 2,
              opacity: diff === 0 ? 1 : 0.8,
              transform: [{ translateX }],
              zIndex: 10 - distance,
            }}
            resizeMode="cover"
          />
        );
      })}
    </View>
  );
}
