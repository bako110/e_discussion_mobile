import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/context/ThemeContext';
import { COUNTRIES, type Country } from '@/utils/countries';

import { Icon } from './Icon';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (c: Country) => void;
  selectedIso?: string;
}

export const CountryPickerModal: React.FC<Props> = ({
  visible,
  onClose,
  onSelect,
  selectedIso,
}) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return COUNTRIES;
    return COUNTRIES.filter(
      (x) => x.name.toLowerCase().includes(term) || x.dial.includes(term),
    );
  }, [q]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.wrap, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" size={24} color={c.text} />
          </Pressable>
          <Text style={[styles.title, { color: c.text }]}>{t('auth.country')}</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Icon name="magnify" size={18} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('auth.searchCountry')}
            placeholderTextColor={c.textFaint}
            autoFocus
            style={[styles.searchInput, { color: c.text }]}
          />
        </View>

        <FlatList
          data={list}
          keyExtractor={(x) => x.iso}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
          renderItem={({ item }) => {
            const active = item.iso === selectedIso;
            return (
              <Pressable
                style={styles.row}
                android_ripple={{ color: c.surfaceAlt }}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text style={styles.flag}>{item.flag}</Text>
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.dial, { color: c.textMuted }]}>+{item.dial}</Text>
                {active ? <Icon name="check" size={18} color={c.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  flag: { fontSize: 22 },
  name: { flex: 1, fontSize: 15, fontWeight: '500' },
  dial: { fontSize: 15 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 54 },
});
