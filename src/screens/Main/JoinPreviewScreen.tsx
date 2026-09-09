import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import { withOnline } from '@/utils/online';
import type { GroupPreview } from '@/types';

/**
 * Aperçu d'un groupe/chaîne avant adhésion (après scan QR ou lien
 * `gofolyx://join/<code>`). Confirme → rejoint → ouvre le chat.
 */
export const JoinPreviewScreen: React.FC<MainScreenProps<'JoinPreview'>> = ({
  route,
  navigation,
}) => {
  const { code, preview: initial } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload: reloadGroups } = useGroups();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [preview, setPreview] = useState<GroupPreview | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    (async () => {
      try {
        const p = await groupService.preview(code);
        if (alive) setPreview(p);
      } catch {
        if (alive) setError(t('groups.codeNotFound'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, initial, t]);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const g = await withOnline(() => groupService.join(code));
      if (!g) {
        setJoining(false);
        return;
      }
      await reloadGroups();
      navigation.replace('GroupChat', { groupId: g.id, name: g.name });
    } catch (e) {
      console.warn('[join] failed:', e);
      setError(t('errors.generic'));
      setJoining(false);
    }
  };

  const isChannel = preview?.kind === 'channel';

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('groups.joinTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : !preview ? (
        <View style={styles.center}>
          <Icon name="qrcode-remove" size={40} color={c.textFaint} />
          <Text style={[styles.errText, { color: c.textMuted }]}>
            {error ?? t('groups.codeNotFound')}
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <Avatar uri={preview.avatar_url} name={preview.name} size={100} />
          <Text style={[styles.name, { color: c.text }]}>{preview.name}</Text>
          <View style={styles.tag}>
            <Icon
              name={isChannel ? 'bullhorn' : 'account-multiple'}
              size={14}
              color={c.textMuted}
            />
            <Text style={[styles.tagText, { color: c.textMuted }]}>
              {isChannel
                ? t('groups.subscribersCount', { count: preview.member_count })
                : t('groups.membersCount', { count: preview.member_count })}
            </Text>
          </View>
          {preview.description ? (
            <Text style={[styles.desc, { color: c.textMuted }]}>{preview.description}</Text>
          ) : null}

          {error ? <Text style={[styles.errText, { color: c.danger }]}>{error}</Text> : null}

          <View style={{ flex: 1 }} />

          {preview.is_member ? (
            <Pressable
              onPress={() =>
                navigation.replace('GroupChat', { groupId: preview.id, name: preview.name })
              }
              style={[styles.cta, { backgroundColor: c.primary, marginBottom: 12 + insets.bottom }]}
            >
              <Icon name="open-in-app" size={18} color="#fff" />
              <Text style={styles.ctaText}>{t('groups.openConversation')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={join}
              disabled={joining}
              style={[
                styles.cta,
                { backgroundColor: c.primary, opacity: joining ? 0.6 : 1, marginBottom: 12 + insets.bottom },
              ]}
            >
              {joining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Icon name="account-plus" size={18} color="#fff" />
                  <Text style={styles.ctaText}>
                    {isChannel ? t('groups.subscribe') : t('groups.joinGroup')}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  errText: { fontSize: 14, textAlign: 'center', fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', gap: 8, paddingTop: 36, paddingHorizontal: 30 },
  name: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tagText: { fontSize: 13, fontWeight: '600' },
  desc: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    paddingVertical: 15,
    borderRadius: 26,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
