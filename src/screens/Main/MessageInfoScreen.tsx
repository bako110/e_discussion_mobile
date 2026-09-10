/**
 * « Infos » d'un message ENVOYÉ (façon WhatsApp) : heures de distribution,
 * de lecture, et — pour un vocal / une vidéo — d'écoute / d'ouverture.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { messageService } from '@/services';

type Info = Awaited<ReturnType<typeof messageService.info>>;

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  return `${day} · ${time}`;
}

export const MessageInfoScreen: React.FC<MainScreenProps<'MessageInfo'>> = ({
  route,
  navigation,
}) => {
  const { messageId, type } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    messageService
      .info(messageId)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setErr(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [messageId]);

  const isVoice = type === 'voice';
  const isVideo = type === 'video';

  const rows: { icon: string; label: string; at: string | null }[] = info
    ? [
        { icon: 'send', label: t('messageInfo.sent'), at: info.sent_at },
        { icon: 'check-all', label: t('messageInfo.delivered'), at: info.delivered_at },
        { icon: 'eye-outline', label: t('messageInfo.read'), at: info.read_at },
        ...(isVoice
          ? [{ icon: 'ear-hearing', label: t('messageInfo.listened'), at: info.played_at }]
          : []),
        ...(isVideo
          ? [
              {
                icon: 'play-circle-outline',
                label: t('messageInfo.opened'),
                at: info.played_at,
              },
            ]
          : []),
      ]
    : [];

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('messageInfo.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : err || !info ? (
        <Text style={[styles.err, { color: c.textMuted }]}>{t('errors.generic')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            {rows.map((r) => (
              <View key={r.label} style={[styles.row, { borderBottomColor: c.divider }]}>
                <Icon name={r.icon} size={20} color={r.at ? c.primary : c.textFaint} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{r.label}</Text>
                  <Text
                    style={[styles.rowValue, { color: r.at ? c.textMuted : c.textFaint }]}
                  >
                    {r.at ? fmt(r.at) : t('messageInfo.pending')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16 },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowValue: { fontSize: 13, marginTop: 2 },
  err: { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
