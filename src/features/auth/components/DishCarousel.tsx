import { Dimensions, Image, View } from 'react-native';
import Carousel from 'react-native-reanimated-carousel';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_SIZE = 170;

const DISHES = [
  {
    id: '1',
    uri: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: '2',
    uri: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: '3',
    uri: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: '4',
    uri: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: '5',
    uri: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=600&q=80',
  },
];

type DishCardProps = {
  uri: string;
};

function DishCard({ uri }: DishCardProps) {
  return (
    <View
      style={{
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        borderRadius: ITEM_SIZE / 2,
        overflow: 'hidden',
        elevation: 3,
      }}
    >
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
    </View>
  );
}

export function DishCarousel() {
  return (
    <Carousel
        data={DISHES}
        width={SCREEN_WIDTH}
        height={ITEM_SIZE}
        loop
        pagingEnabled
        snapEnabled
        style={{ width: SCREEN_WIDTH, height: ITEM_SIZE }}
        mode="parallax"
        modeConfig={{
            parallaxScrollingScale: 0.92,
            parallaxAdjacentItemScale: 0.75,
            parallaxScrollingOffset: 56,
        }}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH, alignItems: 'center' }}>
            <DishCard uri={item.uri} />
          </View>
        )}
        />
  );
}
