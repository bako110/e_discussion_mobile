/**
 * Détail / paramètres d'une conversation 1-to-1.
 *  - en-tête contact (avatar, nom, @username, présence)
 *  - actions rapides : appel audio / vidéo / rechercher
 *  - Médias, liens et docs partagés
 *  - Notifications (sourdine)
 *  - Fond d'écran de la discussion
 *  - Chiffrement (ouvre l'explication)
 *  - Bloquer / Signaler / Effacer la discussion
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Avatar,
  Icon,
  Screen,
  confirmAlert,
  showAlert,
} from '@/components/common';
import { EncryptionInfoModal } from '@/components/chat/EncryptionInfoModal';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { conversationService, userService } from '@/services';
import type { SharedMedia, UserPublic } from '@/types';
import { mediaUrl } from '@/utils/media';
import { lastSeenLabel } from '@/utils/time';

export const ConversationInfoScreen: React.FC<MainScreenProps<'ConversationInfo'>> = ({
  route,
  navigation,
}) => {
  const { conversationId, partnerId, partnerName, partnerAvatar } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { available: callsAvailable, startCall, phase } = useCall();
  const c = theme.colors;

  const [profile, setProfile] = useState<UserPublic | null>(null);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [encOpen, setEncOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [detail, blk, med] = await Promise.all([
        conversationService.detail(conversationId).catch(() => null),
        userService.blockedUsers().catch(() => [] as UserPublic[]),
        conversationService.media(conversationId, 1, 12).catch(() => [] as SharedMedia[]),
      ]);
      if (detail) {
        setMuted(detail.muted);
        setProfile(detail.partner);
      } else {
        setProfile(await userService.getById(partnerId).catch(() => null));
      }
      setBlocked(blk.some((u) => u.id === partnerId));
      setMedia(med);
    } finally {
      setLoading(false);
    }
  }, [conversationId, partnerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    void load();
  }, [load]);

  const name = profile?.display_name || profile?.username || partnerName;
  const avatar = profile?.avatar_url ?? partnerAvatar;

  const call = (kind: 'voice' | 'video') => {
    if (!callsAvailable) {
      showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    if (phase !== 'idle') return;
    startCall(
      {
        id: partnerId,
        username: profile?.username ?? null,
        display_name: name,
        avatar_url: avatar ?? null,
        about: profile?.about ?? null,
        last_seen_at: profile?.last_seen_at ?? null,
        is_online: profile?.is_online ?? false,
      },
      kind,
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : t('calls.startFailed');
      showAlert(t('calls.startFailed'), msg);
    });
  };

  const toggleMute = async (next: boolean) => {
    setMuted(next);
    setBusy('mute');
    try {
      await conversationService.setMuted(conversationId, next);
    } catch {
      setMuted(!next);
    } finally {
      setBusy(null);
    }
  };

  const toggleBlock = () => {
    const next = !blocked;
    confirmAlert(
      next ? t('chat.blockTitle', { name }) : t('chat.unblockTitle', { name }),
      next ? t('chat.blockBody') : t('chat.unblockBody'),
      async () => {
        setBusy('block');
        try {
          if (next) await userService.block(partnerId);
          else await userService.unblock(partnerId);
          setBlocked(next);
        } catch {
          showAlert(t('errors.generic'));
        } finally {
          setBusy(null);
        }
      },
      { destructive: next, confirmText: next ? t('chat.block') : t('chat.unblock') },
    );
  };

  const report = () => {
    confirmAlert(
      t('chat.reportTitle', { name }),
      t('chat.reportBody'),
      async () => {
        // pas d'endpoint dédié : on bloque + message d'accusé
        try {
          await userService.block(partnerId);
          setBlocked(true);
        } catch {
          /* ignore */
        }
        showAlert(t('chat.reportDone'));
      },
      { destructive: true, confirmText: t('chat.report') },
    );
  };

  const clearHistory = () => {
    confirmAlert(
      t('chat.clearTitle'),
      t('chat.clearBody'),
      async () => {
        setBusy('clear');
        try {
          await conversationService.clearHistory(conversationId);
          showAlert(t('chat.cleared'));
        } catch {
          showAlert(t('errors.generic'));
        } finally {
          setBusy(null);
        }
      },
      { destructive: true, confirmText: t('common.delete') },
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('chat.infoTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* En-tête contact */}
          <View style={styles.hero}>
            <Avatar uri={avatar} name={name} size={96} online={profile?.is_online} />
            <Text style={[styles.heroName, { color: c.text }]} numberOfLines={1}>
              {name}
            </Text>
            {profile?.username ? (
              <Text style={[styles.heroSub, { color: c.textMuted }]}>@{profile.username}</Text>
            ) : null}
            {profile ? (
              <Text
                style={[
                  styles.heroSub,
                  { color: profile.is_online ? c.online : c.textFaint, marginTop: 2 },
                ]}
              >
                {lastSeenLabel(profile.last_seen_at ?? null, !!profile.is_online)}
              </Text>
            ) : null}
            {profile?.about ? (
              <Text style={[styles.heroAbout, { color: c.textMuted }]} numberOfLines={3}>
                {profile.about}
              </Text>
            ) : null}
          </View>

          {/* Actions rapides */}
          <View style={styles.quickRow}>
            <QuickAction icon="phone" label={t('calls.voice')} onPress={() => call('voice')} c={c} />
            <QuickAction icon="video" label={t('calls.video')} onPress={() => call('video')} c={c} />
            <QuickAction
              icon="magnify"
              label={t('chat.search')}
              onPress={() =>
                navigation.navigate('Chat', {
                  conversationId,
                  partnerId,
                  partnerName: name,
                  partnerAvatar: avatar,
                })
              }
              c={c}
            />
          </View>

          {/* Médias partagés */}
          <SettingsSection title={t('chat.sharedMedia')}>
            {media.length > 0 ? (
              <View style={styles.mediaWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
                  {media.map((m) => (
                    <Pressable
                      key={m.message_id}
                      style={styles.mediaThumb}
                      onPress={() =>
                        navigation.navigate('MediaViewer', {
                          url: mediaUrl(m.url) ?? m.url,
                          type: m.type === 'video' ? 'video' : 'image',
                        })
                      }
                    >
                      {m.type === 'image' || m.type === 'video' ? (
                        <Image source={{ uri: mediaUrl(m.url) }} style={styles.mediaImg} />
                      ) : (
                        <View style={[styles.mediaImg, styles.mediaFile, { backgroundColor: c.surfaceAlt }]}>
                          <Icon
                            name={m.type === 'voice' ? 'microphone' : 'file-outline'}
                            size={22}
                            color={c.textMuted}
                          />
                        </View>
                      )}
                      {m.type === 'video' ? (
                        <View style={styles.playBadge}>
                          <Icon name="play" size={12} color="#fff" />
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.mediaEmpty}>
                <Text style={[styles.mediaEmptyTxt, { color: c.textFaint }]}>
                  {t('chat.noSharedMedia')}
                </Text>
              </View>
            )}
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection title={t('chat.notifications')}>
            <View style={styles.toggleRow}>
              <Icon name={muted ? 'bell-off-outline' : 'bell-outline'} size={20} color={c.textMuted} />
              <Text style={[styles.toggleLabel, { color: c.text }]}>{t('chat.mute')}</Text>
              <Switch
                value={muted}
                disabled={busy === 'mute'}
                onValueChange={(v) => void toggleMute(v)}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor="#fff"
              />
            </View>
          </SettingsSection>

          {/* Personnalisation + sécurité */}
          <SettingsSection>
            <SettingsRow
              icon="wallpaper"
              label={t('chat.wallpaper')}
              onPress={() => navigation.navigate('ChatsSettings')}
            />
            <SettingsRow
              icon="shield-lock-outline"
              label={t('encryption.title')}
              value={t('chat.encActive')}
              onPress={() => setEncOpen(true)}
              last
            />
          </SettingsSection>

          {/* Zone sensible */}
          <SettingsSection>
            <SettingsRow
              icon={blocked ? 'account-check-outline' : 'account-cancel-outline'}
              label={blocked ? t('chat.unblock') : t('chat.block')}
              danger={!blocked}
              onPress={toggleBlock}
            />
            <SettingsRow icon="flag-outline" label={t('chat.report')} danger onPress={report} />
            <SettingsRow
              icon="trash-can-outline"
              label={busy === 'clear' ? t('common.loading') : t('chat.clearHistory')}
              danger
              onPress={clearHistory}
              last
            />
          </SettingsSection>
        </ScrollView>
      )}

      <EncryptionInfoModal
        visible={encOpen}
        partnerName={name}
        onClose={() => setEncOpen(false)}
      />
    </Screen>
  );
};

const QuickAction: React.FC<{
  icon: string;
  label: string;
  onPress: () => void;
  c: ReturnType<typeof useTheme>['theme']['colors'];
}> = ({ icon, label, onPress, c }) => (
  <Pressable style={styles.quick} onPress={onPress} android_ripple={{ color: c.surfaceAlt }}>
    <View style={[styles.quickIcon, { backgroundColor: c.surfaceAlt }]}>
      <Icon name={icon} size={20} color={c.primary} />
    </View>
    <Text style={[styles.quickLabel, { color: c.textMuted }]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40 },

  hero: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 24 },
  heroName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 8 },
  heroSub: { fontSize: 14 },
  heroAbout: { fontSize: 13.5, textAlign: 'center', lineHeight: 19, marginTop: 4 },

  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 6 },
  quick: { alignItems: 'center', gap: 6, width: 74 },
  quickIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 12, fontWeight: '600' },

  mediaWrap: { paddingVertical: 10 },
  mediaRow: { paddingHorizontal: 12, gap: 8 },
  mediaThumb: { width: 78, height: 78, borderRadius: 10, overflow: 'hidden' },
  mediaImg: { width: 78, height: 78, borderRadius: 10 },
  mediaFile: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaEmpty: { padding: 16, alignItems: 'center' },
  mediaEmptyTxt: { fontSize: 13 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
});
