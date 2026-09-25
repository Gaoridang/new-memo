import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';

type HeaderIcon = NonNullable<ComponentProps<typeof Stack.Toolbar.Button>['icon']>;
type SFSymbol = Exclude<HeaderIcon, ImageSourcePropType>;

// iOS 헤더는 SF Symbol을 쓰고, Android 툴바는 이미지 아이콘만 받으므로
// icons.tsx와 같은 모양을 PNG로 그려 둔 것을 쓴다.
function headerIcon(sf: SFSymbol, image: ImageSourcePropType): HeaderIcon {
  return Platform.OS === 'ios' ? sf : image;
}

export const headerIcons = {
  compose: headerIcon('square.and.pencil', require('../assets/header/compose.png')),
  share: headerIcon('square.and.arrow.up', require('../assets/header/share.png')),
  more: headerIcon('ellipsis', require('../assets/header/more.png')),
};

// 메뉴 항목 아이콘은 iOS에서만 보여 준다.
export const menuIcon = (sf: SFSymbol) => (Platform.OS === 'ios' ? sf : undefined);
