import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * A diagonal gradient that fills its parent; put it first so the content sits on top.
 * Pass the parent's border radius: the rectangle rounds itself, so the parent needs no
 * `overflow: 'hidden'` (which would clip the parent's shadow on iOS).
 */
export default function Gradient({
  colors,
  radius = 0,
}: {
  colors: string[];
  radius?: number;
}) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {colors.map((c, i) => (
            <Stop
              key={c + i}
              offset={colors.length === 1 ? 0 : i / (colors.length - 1)}
              stopColor={c}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={radius} fill={`url(#${id})`} />
    </Svg>
  );
}
