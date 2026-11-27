import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { User } from '../lib/api';
import { initials } from '../lib/initials';
import { useTheme } from '../lib/theme';

/** The user's photo, or their initials on the accent tint. */
export default function Avatar({
  user,
  size = 36,
}: {
  user: User | null;
  size?: number;
}) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (user?.avatarUrl && !failed) {
    return (
      <Image
        source={{ uri: user.avatarUrl }}
        style={[box, { backgroundColor: t.cardHi }]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.center, box, { backgroundColor: t.accentSoft }]}>
      <Text
        style={[styles.text, { color: t.accent, fontSize: size * 0.38 }]}
        allowFontScaling={false}
      >
        {initials(user)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', letterSpacing: 0.5 },
});
