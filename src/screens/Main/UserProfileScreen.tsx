/**
 * Aperçu du profil d'un utilisateur, en LECTURE SEULE — façon WhatsApp.
 * Ouvert en tapant une photo de profil n'importe où hors du chat (recherche
 * « Nouvelle conversation », membres d'un groupe…). Contrairement à
 * ConversationInfoScreen, cet écran ne suppose PAS qu'une conversation existe
 * déjà : « Envoyer un message » en crée une si besoin.
 *
 * Confidentialité : `userService.getById` renvoie déjà les champs
 * (avatar_url, about, last_seen_at, is_online) filtrés côté backend selon les
 * réglages du profil consulté (voir `serialize_public` côté serveur) — rien
 * à recalculer ici, on affiche simplement ce qui revient (ou rien).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import {
  AppHeader,
  Avatar,
  Icon,
  Screen,
  confirmAlert,
  showAlert,
  showToast,
} from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { conversationService, groupService, userService } from '@/services';
import { syncNow } from '@/sync/syncEngine';
import type { UserPublic } from '@/types';
import { callStartErrorMessage } from '@/utils/callError';
import { lastSeenLabel } from '@/utils/time';

export const UserProfileScreen: React.FC<MainScreenProps<'UserProfile'>> = ({
  route,
  navigation,
}) => {
  const { userId, name: fallbackName, avatar: fallbackAvatar, group } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const { available: callsAvailable, startCall, phase } = useCall();
  const { online } = useSync();
  const c = theme.colors;

  const [profile, setProfile] = useState<UserPublic | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // rôle du membre dans le groupe d'origine — modifiable localement après
  // promotion/rétrogradation pour que le libellé du bouton suive sans reload.
  const [memberRole, setMemberRole] = useState(group?.role);

  const load = useCallback(async () => {
    try {
      const [remote, blk] = await Promise.all([
        userService.getById(userId).catch(() => null),
        userService.blockedUsers().catch(() => [] as UserPublic[]),
      ]);
      if (remote) setProfile(remote);
      setBlocked(blk.some((u) => u.id === userId));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    void load();
  }, [load]);

  const name = profile?.display_name || profile?.username || fallbackName || '—';
  const avatar = blocked ? null : (profile?.avatar_url ?? fallbackAvatar);
  const isOnline = online && !!profile?.is_online;

  const openChat = async () => {
    if (busy) return;
    setBusy('chat');
    try {
      const detail = await conversationService.start(userId);
      navigation.replace('Chat', {
        conversationId: detail.id,
        partnerId: userId,
        partnerName: name,
        partnerAvatar: avatar,
      });
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
      setBusy(null);
    }
  };

  const call = (kind: 'voice' | 'video') => {
    if (!callsAvailable) {
      showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    // 'ended' est un état transitoire (~1.6s après un appel précédent) —
    // pas un appel en cours ; `startCall` gère déjà ce cas correctement.
    if (phase !== 'idle' && phase !== 'ended') return;
    startCall(
      {
        id: userId,
        username: profile?.username ?? null,
        display_name: name,
        avatar_url: avatar ?? null,
        about: profile?.about ?? null,
        last_seen_at: profile?.last_seen_at ?? null,
        is_online: profile?.is_online ?? false,
      },
      kind,
    ).catch((e: unknown) => {
      showAlert(t('calls.startFailed'), callStartErrorMessage(e, t('calls.startFailedBody')));
    });
  };

  const toggleBlock = () => {
    const next = !blocked;
    confirmAlert(
      next ? t('chat.blockTitle', { name }) : t('chat.unblockTitle', { name }),
      next ? t('chat.blockBody') : t('chat.unblockBody'),
      async () => {
        setBusy('block');
        try {
          if (next) await userService.block(userId);
          else await userService.unblock(userId);
          setBlocked(next);
          showToast(next ? t('chat.userBlocked') : t('settings.userUnblocked'));
          void load();
        } catch {
          showToast(t('errors.generic'), { type: 'error' });
        } finally {
          setBusy(null);
        }
      },
      { destructive: next, confirmText: next ? t('chat.block') : t('chat.unblock') },
    );
  };

  // ── Contexte groupe : gestion du rôle de CE membre (admin/owner only) ────
  const isMe = userId === me?.id;
  const canManageMember = !!group?.canManage && !isMe && memberRole !== 'owner';

  const runMemberAction = (p: Promise<unknown>, okKey: string) => {
    if (!group) return;
    setBusy('member');
    p.then(() => syncNow({ force: true }))
      .then(() => showToast(t(okKey)))
      .catch(() => showToast(t('errors.generic'), { type: 'error' }))
      .finally(() => setBusy(null));
  };

  const promote = () => {
    if (!group) return;
    runMemberAction(
      groupService.setMemberRole(group.groupId, userId, 'admin'),
      'groups.adminAdded',
    );
    setMemberRole('admin');
  };
  const demote = () => {
    if (!group) return;
    runMemberAction(
      groupService.setMemberRole(group.groupId, userId, group.isChannel ? 'subscriber' : 'member'),
      'groups.adminRemoved',
    );
    setMemberRole(group.isChannel ? 'subscriber' : 'member');
  };
  const removeFromGroup = () => {
    if (!group) return;
    confirmAlert(
      group.isChannel ? t('groups.removeSubscriber') : t('groups.removeMember'),
      t('chat.blockBody'), // pas de libellé dédié — confirmation générique suffisante
      () => {
        runMemberAction(
          groupService.removeMember(group.groupId, userId),
          'groups.memberRemoved',
        );
        navigation.goBack();
      },
      { destructive: true, confirmText: t('common.delete') },
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('chat.infoTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.text} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          {/* ── Carte profil ─────────────────────────────────────────── */}
          <View style={styles.hero}>
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <RadialGradient id="upHeroGlow" cx="50%" cy="0%" r="85%">
                  <Stop offset="0" stopColor={c.primary} stopOpacity={theme.isDark ? 0.28 : 0.14} />
                  <Stop offset="0.55" stopColor={c.accent} stopOpacity={0.06} />
                  <Stop offset="1" stopColor={c.background} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#upHeroGlow)" />
            </Svg>

            <View style={styles.avatarShell}>
              <Avatar uri={avatar} name={name} size={120} />
              {isOnline && !blocked ? (
                <View style={[styles.onlineDot, { backgroundColor: c.online, borderColor: c.background }]} />
              ) : null}
            </View>

            <Text style={[styles.heroName, { color: c.text }]} numberOfLines={1}>
              {name}
            </Text>
            {profile?.username ? (
              <Text style={[styles.heroHandle, { color: c.primary }]}>@{profile.username}</Text>
            ) : null}

            {!blocked ? (
              <View style={styles.presenceRow}>
                <View style={[styles.presenceDot, { backgroundColor: isOnline ? c.online : c.textFaint }]} />
                <Text style={[styles.presenceTxt, { color: isOnline ? c.online : c.textMuted }]}>
                  {profile ? lastSeenLabel(profile.last_seen_at ?? null, isOnline) : ''}
                </Text>
              </View>
            ) : (
              <View style={styles.presenceRow}>
                <Icon name="cancel" size={13} color={c.danger} />
                <Text style={[styles.presenceTxt, { color: c.danger }]}>{t('chat.blockedBanner')}</Text>
              </View>
            )}

            {profile?.about ? (
              <View style={[styles.bioCard, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="format-quote-open" size={14} color={c.textFaint} />
                <Text style={[styles.bioTxt, { color: c.textMuted }]} numberOfLines={4}>
                  {profile.about}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Actions rapides */}
          <View style={styles.quickRow}>
            <QuickAction
              icon="message-text"
              label={t('conversations.newChat')}
              onPress={() => void openChat()}
              c={c}
              disabled={blocked || busy === 'chat'}
              primary
            />
            <QuickAction icon="phone" label={t('calls.voice')} onPress={() => call('voice')} c={c} disabled={blocked} />
            <QuickAction icon="video" label={t('calls.video')} onPress={() => call('video')} c={c} disabled={blocked} />
          </View>

          {/* Rôle dans le groupe d'origine + actions de gestion (admin/owner) */}
          {group ? (
            <View style={[styles.groupSection, { borderColor: c.border }]}>
              <View style={styles.groupRoleRow}>
                <Icon
                  name={memberRole === 'owner' || memberRole === 'admin' ? 'shield-account' : 'account-outline'}
                  size={16}
                  color={c.textMuted}
                />
                <Text style={[styles.groupRoleTxt, { color: c.textMuted }]}>
                  {memberRole === 'owner'
                    ? t('groups.roleOwner')
                    : memberRole === 'admin'
                      ? t('groups.roleAdmin')
                      : group.isChannel
                        ? t('groups.subscribers')
                        : t('groups.members')}
                </Text>
              </View>
              {canManageMember ? (
                <View style={styles.groupActions}>
                  {memberRole === 'admin' ? (
                    <SettingsGroupAction
                      icon="shield-off-outline"
                      label={t('groups.demoteAdmin')}
                      onPress={demote}
                      c={c}
                    />
                  ) : (
                    <SettingsGroupAction
                      icon="shield-account-outline"
                      label={t('groups.promoteAdmin')}
                      onPress={promote}
                      c={c}
                    />
                  )}
                  <SettingsGroupAction
                    icon="account-remove-outline"
                    label={group.isChannel ? t('groups.removeSubscriber') : t('groups.removeMember')}
                    onPress={removeFromGroup}
                    c={c}
                    danger
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          {/* Zone sensible */}
          <View style={{ flexDirection: 'row' }}>
            <Pressable
              onPress={toggleBlock}
              disabled={busy === 'block'}
              style={[styles.dangerRow, { flex: 1, borderTopColor: c.divider }]}
            >
              <Icon
                name={blocked ? 'account-check-outline' : 'account-cancel-outline'}
                size={20}
                color={c.danger}
              />
              <Text style={[styles.dangerTxt, { color: c.danger }]}>
                {blocked ? t('chat.unblock') : t('chat.block')}
              </Text>
            </Pressable>
            {!isMe ? (
              <Pressable
                onPress={() => navigation.navigate('ReportProfile', { userId, name })}
                style={[styles.dangerRow, { flex: 1, borderTopColor: c.divider, borderLeftColor: c.divider, borderLeftWidth: StyleSheet.hairlineWidth }]}
              >
                <Icon name="flag-outline" size={20} color={c.danger} />
                <Text style={[styles.dangerTxt, { color: c.danger }]}>{t('chat.report')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
    </Screen>
  );
};

const QuickAction: React.FC<{
  icon: string;
  label: string;
  onPress: () => void;
  c: ReturnType<typeof useTheme>['theme']['colors'];
  disabled?: boolean;
  primary?: boolean;
}> = ({ icon, label, onPress, c, disabled, primary }) => (
  <Pressable
    style={[styles.quick, disabled && { opacity: 0.4 }]}
    onPress={onPress}
    disabled={disabled}
    android_ripple={{ color: c.surfaceAlt }}
  >
    <View
      style={[
        styles.quickIcon,
        { backgroundColor: primary ? c.primary : c.primary + '16' },
      ]}
    >
      <Icon name={icon} size={21} color={primary ? '#fff' : c.primary} />
    </View>
    <Text style={[styles.quickLabel, { color: c.textMuted }]}>{label}</Text>
  </Pressable>
);

const SettingsGroupAction: React.FC<{
  icon: string;
  label: string;
  onPress: () => void;
  c: ReturnType<typeof useTheme>['theme']['colors'];
  danger?: boolean;
}> = ({ icon, label, onPress, c, danger }) => (
  <Pressable
    style={styles.groupActionRow}
    onPress={onPress}
    android_ripple={{ color: c.surfaceAlt }}
  >
    <Icon name={icon} size={18} color={danger ? c.danger : c.text} />
    <Text style={[styles.groupActionTxt, { color: danger ? c.danger : c.text }]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },

  hero: { alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 20, paddingHorizontal: 28 },
  avatarShell: { marginTop: 8 },
  onlineDot: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
  },
  heroName: { fontSize: 23, fontWeight: '800', letterSpacing: -0.4, marginTop: 14 },
  heroHandle: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  presenceDot: { width: 7, height: 7, borderRadius: 3.5 },
  presenceTxt: { fontSize: 13, fontWeight: '600' },
  bioCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    maxWidth: 340,
    alignSelf: 'stretch',
  },
  bioTxt: { flex: 1, fontSize: 13.5, lineHeight: 19 },

  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 30, paddingTop: 4 },

  groupSection: {
    marginTop: 24,
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  groupRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  groupRoleTxt: { fontSize: 13, fontWeight: '600' },
  groupActions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(140,150,170,0.18)' },
  groupActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  groupActionTxt: { fontSize: 14, fontWeight: '600' },
  quick: { alignItems: 'center', gap: 6, width: 74 },
  quickIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 12, fontWeight: '600' },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dangerTxt: { fontSize: 15, fontWeight: '700' },
});
