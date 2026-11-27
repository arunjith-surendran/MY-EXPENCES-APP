import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { glow, useTheme } from '../lib/theme';

type IconName = 'home' | 'calendar' | 'zap' | 'user' | 'plus';

/** Line icons on a 24×24 grid, drawn in the tab's color. */
function Icon({
  name,
  color,
  size = 24,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && (
        <Path
          d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
          {...stroke}
        />
      )}
      {name === 'calendar' && (
        <>
          <Rect x={3} y={4.5} width={18} height={16.5} rx={2.5} {...stroke} />
          <Path d="M8 2.5v4M16 2.5v4M3 10h18" {...stroke} />
        </>
      )}
      {name === 'zap' && (
        <Path d="M13 2 4 13.5h7.5L10.5 22 20 10.5h-7.5z" {...stroke} />
      )}
      {name === 'user' && (
        <>
          <Circle cx={12} cy={8} r={4} {...stroke} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...stroke} />
        </>
      )}
      {name === 'plus' && (
        <Path d="M12 5v14M5 12h14" {...stroke} strokeWidth={2.6} />
      )}
    </Svg>
  );
}

const TABS: Record<string, { icon: IconName; label: string }> = {
  Home: { icon: 'home', label: 'Home' },
  ThisMonth: { icon: 'calendar', label: 'Month' },
  Setup: { icon: 'zap', label: 'Auto-log' },
  Account: { icon: 'user', label: 'Account' },
};

/**
 * Bottom navigation: four tabs around a raised "+" in the middle. The "+" isn't a real
 * tab; it opens the Add expense sheet on top of whichever tab is showing.
 */
export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.card,
          borderTopColor: t.border,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        if (route.name === 'NewExpense') {
          return (
            <View key={route.key} style={styles.item}>
              <Pressable
                onPress={() => navigation.navigate('Add')}
                accessibilityRole="button"
                accessibilityLabel="Add expense"
                style={({ pressed }) => [
                  styles.add,
                  {
                    backgroundColor: t.accent,
                    borderColor: t.card,
                    opacity: pressed ? 0.85 : 1,
                  },
                  glow(t.accent, 14),
                ]}
              >
                <Icon name="plus" color={t.onAccent} size={26} />
              </Pressable>
            </View>
          );
        }

        const tab = TABS[route.name];
        const focused = state.index === index;
        const color = focused ? t.accent : t.muted;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            style={styles.item}
          >
            <View
              style={[
                styles.pill,
                focused && { backgroundColor: t.accentSoft },
              ]}
            >
              <Icon name={tab.icon} color={color} />
            </View>
            <Text
              style={[styles.label, focused && styles.labelActive, { color }]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: { flex: 1, alignItems: 'center' },
  pill: {
    width: 52,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  labelActive: { fontWeight: '800' },
  add: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    marginTop: -26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
