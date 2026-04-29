import {
  Image,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

interface FloatingFoodImageProps {
  source: ImageSourcePropType;
  leftPercent?: number;
  topPercent?: number;
  widthPercent?: number;
  sizeScale?: number;
  zIndex?: number;
  containerStyle?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}

const DEFAULT_LEFT_PERCENT = 92;
const DEFAULT_TOP_PERCENT = 30;
const DEFAULT_WIDTH_PERCENT = 40;
const DEFAULT_SIZE_SCALE = 1.62;
const DEFAULT_Z_INDEX = 10;
export function FloatingFoodImage({
  source,
  leftPercent = DEFAULT_LEFT_PERCENT,
  topPercent = DEFAULT_TOP_PERCENT,
  widthPercent = DEFAULT_WIDTH_PERCENT,
  sizeScale = DEFAULT_SIZE_SCALE,
  zIndex = DEFAULT_Z_INDEX,
  containerStyle,
  imageStyle,
}: FloatingFoodImageProps) {
  const { width: screenWidth } = useWindowDimensions();
  const imageWidth = Math.round((screenWidth * widthPercent * sizeScale) / 100);

  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: `${leftPercent}%`,
          top: `${topPercent}%`,
          transform: [{ translateX: -imageWidth / 2 }, { translateY: -imageWidth / 2 }],
          zIndex,
        },
        containerStyle,
      ]}>
      <Image
        source={source}
        resizeMode="contain"
        style={[{ width: imageWidth, height: imageWidth }, imageStyle]}
      />
    </View>
  );
}
