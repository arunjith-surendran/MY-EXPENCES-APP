import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../../App';
import { clearSalary, getSalaryInfo, salaryFor, setSalary } from '../lib/db';
import { monthKey, monthLabel } from '../lib/months';
import { parseAmount } from '../lib/parse';
import { useSalaryPrivacy } from '../lib/salaryPrivacy';
import { glow, useTheme } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Salary'>;

export default function SalaryScreen({ navigation, route }: Props) {
  const t = useTheme();
  const month = route.params?.month ?? monthKey();
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [hasSalary, setHasSalary] = useState(false);
  const { reveal } = useSalaryPrivacy();

  useEffect(() => {
    getSalaryInfo().then(async info => {
      const current = salaryFor(info, month);
      // Editing shows the saved amount, so it needs the same Face ID as the eye button.
      if (current != null && !(await reveal())) {
        navigation.goBack();
        return;
      }
      if (current != null) setAmount(String(current));
      setHasSalary(current != null);
      // A month with its own override is edited as "only this month".
      setRecurring(!(month in info.overrides));
    });
    // Runs once per month opened; revealing must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const save = async () => {
    const value = parseAmount(amount);
    if (value == null) {
      Alert.alert(
        'Enter your salary',
        'Type the amount you receive, e.g. 15000.',
      );
      return;
    }
    await setSalary(month, value, recurring);
    navigation.goBack();
  };

  const remove = () =>
    Alert.alert(
      'Remove salary?',
      `Salary for ${monthLabel(month)} will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearSalary(month);
            navigation.goBack();
          },
        },
      ],
    );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: t.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: t.muted }]}>
          Monthly salary (AED)
        </Text>
        <TextInput
          style={[
            styles.input,
            { color: t.text, backgroundColor: t.card, borderColor: t.success },
            glow(t.success, 10),
          ]}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={t.muted}
          autoFocus
        />

        <Text style={[styles.label, { color: t.muted }]}>Applies to</Text>
        <Option
          active={recurring}
          onPress={() => setRecurring(true)}
          title="Every month"
          body={`From ${monthLabel(month)} onwards. Change it any time.`}
        />
        <Option
          active={!recurring}
          onPress={() => setRecurring(false)}
          title={`Only ${monthLabel(month)}`}
          body="For a bonus, a raise, or a month with a different amount."
        />

        <Pressable
          onPress={save}
          style={[
            styles.button,
            { backgroundColor: t.success },
            glow(t.success),
          ]}
        >
          <Text style={[styles.buttonText, { color: t.onAccent }]}>
            Save salary
          </Text>
        </Pressable>

        {hasSalary && (
          <Pressable
            onPress={remove}
            style={[styles.button, styles.outline, { borderColor: t.danger }]}
          >
            <Text style={[styles.buttonText, { color: t.danger }]}>
              Remove salary
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Option({
  active,
  onPress,
  title,
  body,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  body: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.option,
        { backgroundColor: t.card, borderColor: active ? t.success : t.border },
        active && glow(t.success, 8),
      ]}
    >
      <View
        style={[styles.radio, { borderColor: active ? t.success : t.muted }]}
      >
        {active && (
          <View style={[styles.radioDot, { backgroundColor: t.success }]} />
        )}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, { color: t.text }]}>{title}</Text>
        <Text style={[styles.optionBody, { color: t.muted }]}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: 16, gap: 12 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 32,
    fontWeight: '800',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  optionTitle: { fontSize: 16, fontWeight: '700' },
  optionBody: { fontSize: 13, marginTop: 2 },
  button: { marginTop: 8, padding: 16, borderRadius: 14, alignItems: 'center' },
  outline: { borderWidth: 1 },
  buttonText: { fontWeight: '800', fontSize: 16 },
});
