import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { restoreExpenses } from '../lib/db';

const SHOW_MS = 6000;

type Pending = {
  message: string;
  ids: number[];
  onUndone?: () => void;
};

type Undo = {
  /** Shows "3 expenses deleted · Undo" for a few seconds after moving them to the bin. */
  showUndo: (p: Pending) => void;
};

const UndoContext = createContext<Undo>({ showUndo: () => {} });

export function useUndo() {
  return useContext(UndoContext);
}

/** Deleted expenses go to the bin; this bar brings them straight back. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = useSharedValue(0);

  const hide = useCallback(() => {
    shown.value = withTiming(0, { duration: 180 });
    setTimeout(() => setPending(null), 190);
  }, [shown]);

  const showUndo = useCallback(
    (p: Pending) => {
      if (timer.current) clearTimeout(timer.current);
      setPending(p);
      shown.value = withTiming(1, { duration: 200 });
      timer.current = setTimeout(hide, SHOW_MS);
    },
    [hide, shown],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const undo = async () => {
    if (!pending || busy) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      await restoreExpenses(pending.ids);
      pending.onUndone?.();
    } finally {
      setBusy(false);
      hide();
    }
  };

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 20 }],
  }));

  const value = useMemo(() => ({ showUndo }), [showUndo]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {pending && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { bottom: Math.max(insets.bottom, 10) + 78 },
            style,
          ]}
        >
          <View style={styles.toast}>
            <Text numberOfLines={2} style={styles.message}>
              {pending.message}
            </Text>
            <Pressable
              onPress={undo}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Undo delete"
            >
              <Text style={styles.undo}>{busy ? '…' : 'Undo'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </UndoContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 90 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    // Dark in both themes, like the system's own toasts.
    backgroundColor: '#1C2333',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  message: { flex: 1, fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  undo: { fontSize: 15, fontWeight: '900', color: '#8DB6FF' },
});
