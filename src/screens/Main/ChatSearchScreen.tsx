/**
 * Recherche de messages (texte + plage de dates) — réutilisable pour une
 * conversation 1-to-1 ET un groupe/chaîne (`route.params.mode`). Recherche
 * 100% locale (SQLite déjà synchronisée) : `body` est en clair une fois
 * déchiffré, voir `messageRepo.search`/`groupRepo.search`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { messageService, groupService } from '@/services';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import type { LocalGroupMessage } from '@/db/repositories/groupRepo';
import type { MainScreenProps } from '@/navigation/types';

type ResultItem = { id: string; createdAt: string; body: string; senderLabel: string | null };

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function startOfDay(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function endOfDay(d: Date): string {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

/** Extrait + heure façon « aujourd'hui/hier/date à HH:MM » — pas de helper
 * existant combinant date ET heure dans `utils/time.ts` (dayLabel/clockTime
 * sont séparés), on compose donc les deux ici. */
function fullDateTimeLabel(iso: string, lang: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Découpe le texte autour de la 1re occurrence (insensible à la casse) pour
 * surligner le terme recherché ; retombe sur le texte tronqué tel quel si le
 * terme n'est plus dedans (ex: résultat obtenu par date uniquement). */
function splitAroundMatch(body: string, q: string): [string, string, string] {
  if (!q) return [body, '', ''];
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return [body, '', ''];
  return [body.slice(0, idx), body.slice(idx, idx + q.length), body.slice(idx + q.length)];
}

export const ChatSearchScreen: React.FC<MainScreenProps<'ChatSearch'>> = ({ route, navigation }) => {
  const params = route.params;
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [text, setText] = useState('');
  const debouncedText = useDebounced(text, 300);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const searchSeq = useRef(0);

  const runSearch = useCallback(async () => {
    const q = debouncedText.trim();
    if (!q && !dateFrom && !dateTo) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const opts = {
        queryText: q || undefined,
        dateFrom: dateFrom ? startOfDay(dateFrom) : undefined,
        dateTo: dateTo ? endOfDay(dateTo) : undefined,
      };
      const items: ResultItem[] =
        params.mode === 'dm'
          ? (await messageService.search(params.conversationId, opts)).map((m: LocalMessage) => ({
              id: m.id,
              createdAt: m.created_at,
              body: m.body,
              senderLabel: null,
            }))
          : (await groupService.search(params.groupId, opts)).map((m: LocalGroupMessage) => ({
              id: m.id,
              createdAt: m.created_at,
              body: m.body,
              senderLabel: m.sender?.display_name || m.sender?.username || null,
            }));
      if (seq === searchSeq.current) setResults(items);
    } catch (e) {
      console.warn('[ChatSearchScreen] search failed:', e);
      if (seq === searchSeq.current) setResults([]);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, [debouncedText, dateFrom, dateTo, params]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const onPickerChange = (event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS === 'android') setOpenPicker(null);
    if (event.type === 'dismissed' || !picked) return;
    if (openPicker === 'from') setDateFrom(picked);
    else if (openPicker === 'to') setDateTo(picked);
  };

  const openResult = (item: ResultItem) => {
    if (params.mode === 'dm') {
      navigation.navigate('Chat', {
        conversationId: params.conversationId,
        partnerId: params.partnerId,
        partnerName: params.partnerName,
        partnerAvatar: params.partnerAvatar,
        jumpToMessageId: item.id,
        jumpToCreatedAt: item.createdAt,
      });
    } else {
      navigation.navigate('GroupChat', {
        groupId: params.groupId,
        name: params.groupName,
        jumpToMessageId: item.id,
        jumpToCreatedAt: item.createdAt,
      });
    }
  };

  const hasQuery = !!(text.trim() || dateFrom || dateTo);

  const renderItem = ({ item }: { item: ResultItem }) => {
    const [before, match, after] = splitAroundMatch(item.body, debouncedText.trim());
    return (
      <Pressable
        onPress={() => openResult(item)}
        style={[styles.resultRow, { borderBottomColor: c.divider }]}
      >
        <View style={[styles.resultIcon, { backgroundColor: c.primary + '16' }]}>
          <Icon name="message-text-outline" size={18} color={c.primary} />
        </View>
        <View style={styles.resultBody}>
          {item.senderLabel ? (
            <Text style={[styles.resultSender, { color: c.primary }]} numberOfLines={1}>
              {item.senderLabel}
            </Text>
          ) : null}
          <Text style={[styles.resultTxt, { color: c.text }]} numberOfLines={2}>
            {before}
            {match ? (
              <Text style={[styles.resultMatch, { backgroundColor: c.primary + '33', color: c.text }]}>
                {match}
              </Text>
            ) : null}
            {after}
          </Text>
          <Text style={[styles.resultDate, { color: c.textFaint }]}>
            {fullDateTimeLabel(item.createdAt, i18n.language)}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        full={
          <View style={styles.hdr}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
              <Icon name="arrow-left" size={24} color={c.text} />
            </Pressable>
            <View style={[styles.searchField, { backgroundColor: c.surfaceAlt }]}>
              <Icon name="magnify" size={18} color={c.textFaint} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('chat.searchPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus
                style={[styles.searchInput, { color: c.text }]}
              />
              {text ? (
                <Pressable onPress={() => setText('')} hitSlop={8}>
                  <Icon name="close-circle" size={16} color={c.textFaint} />
                </Pressable>
              ) : null}
            </View>
          </View>
        }
      />

      <View style={styles.dateRow}>
        <Pressable
          onPress={() => setOpenPicker('from')}
          style={[styles.dateChip, { borderColor: dateFrom ? c.primary : c.border }]}
        >
          <Icon name="calendar-start" size={15} color={dateFrom ? c.primary : c.textFaint} />
          <Text style={[styles.dateChipTxt, { color: dateFrom ? c.primary : c.textMuted }]}>
            {dateFrom ? formatDate(dateFrom) : t('chat.searchDateFrom')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setOpenPicker('to')}
          style={[styles.dateChip, { borderColor: dateTo ? c.primary : c.border }]}
        >
          <Icon name="calendar-end" size={15} color={dateTo ? c.primary : c.textFaint} />
          <Text style={[styles.dateChipTxt, { color: dateTo ? c.primary : c.textMuted }]}>
            {dateTo ? formatDate(dateTo) : t('chat.searchDateTo')}
          </Text>
        </Pressable>
        {dateFrom || dateTo ? (
          <Pressable
            onPress={() => {
              setDateFrom(null);
              setDateTo(null);
            }}
            hitSlop={8}
            style={styles.dateClear}
          >
            <Icon name="close" size={16} color={c.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : !hasQuery ? (
        <View style={styles.center}>
          <Icon name="magnify" size={34} color={c.textFaint} />
          <Text style={[styles.emptyTxt, { color: c.textMuted }]}>{t('chat.searchHint')}</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.center}>
          <Icon name="text-search" size={34} color={c.textFaint} />
          <Text style={[styles.emptyTxt, { color: c.textMuted }]}>{t('chat.searchNoResults')}</Text>
        </View>
      ) : (
        <FlatList data={results} keyExtractor={(it) => it.id} renderItem={renderItem} />
      )}

      {openPicker ? (
        <DateTimePicker
          value={(openPicker === 'from' ? dateFrom : dateTo) ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickerChange}
        />
      ) : null}
      {Platform.OS === 'ios' && openPicker ? (
        <Pressable
          onPress={() => setOpenPicker(null)}
          style={[styles.iosDoneBtn, { backgroundColor: c.primary }]}
        >
          <Text style={styles.iosDoneTxt}>{t('common.done')}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
};

/** Debounce minimal — évite une requête SQLite à chaque frappe. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const styles = StyleSheet.create({
  hdr: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 38,
  },
  searchInput: { flex: 1, fontSize: 14.5, padding: 0 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.2,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dateChipTxt: { fontSize: 12.5, fontWeight: '700' },
  dateClear: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 30 },
  emptyTxt: { fontSize: 13.5, textAlign: 'center' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  resultBody: { flex: 1, gap: 2 },
  resultSender: { fontSize: 12.5, fontWeight: '800' },
  resultTxt: { fontSize: 14.5, lineHeight: 19 },
  resultMatch: { fontWeight: '800' },
  resultDate: { fontSize: 11.5, marginTop: 2 },
  iosDoneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
    marginHorizontal: 20,
    borderRadius: 24,
  },
  iosDoneTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
