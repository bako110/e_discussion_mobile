import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AppHeader,
  Avatar,
  Icon,
  Screen,
  confirmAlert,
  showAlert,
  showSheet,
  showToast,
} from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useGroups } from '@/context/GroupsContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import { useTheme } from '@/context/ThemeContext';
import { groupRepo, type LocalGroup } from '@/db/repositories/groupRepo';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import { withOnline } from '@/utils/online';
import { syncNow } from '@/sync/syncEngine';
import type { GroupMember } from '@/types';

/** Deep-link d'invitation encodé dans le QR / partagé par lien. */
export const inviteLink = (code: string) => `gofolyx://join/${code}`;

export const GroupInfoScreen: React.FC<MainScreenProps<'GroupInfo'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const { reload: reloadGroups } = useGroups();
  const picker = useMediaPicker();
  const c = theme.colors;

  const [group, setGroup] = useState<LocalGroup | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descTruncated, setDescTruncated] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** Recharge l'entête depuis SQLite (local-first) + membres depuis le serveur. */
  const reload = React.useCallback(async () => {
    const g = await groupRepo.get(groupId);
    if (g) {
      setGroup(g);
      setDescDraft(g.description ?? '');
      setNameDraft(g.name);
      setDescExpanded(false);
      setDescTruncated(false);
    }
    setLoading(false);
    // best-effort serveur
    try {
      const m = await groupService.members(groupId);
      setMembers(m);
    } catch {
      /* hors-ligne */
    }
    try {
      await groupService.refreshMessages(groupId); // rafraîchit aussi l'entête
      const g2 = await groupRepo.get(groupId);
      if (g2) setGroup(g2);
    } catch {
      /* hors-ligne */
    }
  }, [groupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isChannel = group?.kind === 'channel';
  const isOwner = group?.my_role === 'owner';
  const canEdit = group?.my_role === 'owner' || group?.my_role === 'admin';

  const changeAvatar = () => {
    if (!canEdit) return;
    showSheet({
      title: t('settings.changePhoto'),
      actions: [
        { label: t('stories.fromGallery'), icon: 'image-outline', onPress: () => void pickAvatar(false) },
        { label: t('stories.fromCamera'), icon: 'camera-outline', onPress: () => void pickAvatar(true) },
      ],
    });
  };

  const pickAvatar = async (camera: boolean) => {
    // recadrage circulaire local AVANT upload
    const up = await picker.pickAvatar({ camera });
    if (!up) return;
    try {
      await groupService.update(groupId, { avatar_url: up.url });
      await reload();
      await reloadGroups();
      void syncNow({ force: true });
      showToast(t('groups.photoUpdated'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === group?.name) {
      setEditingName(false);
      return;
    }
    try {
      await groupService.update(groupId, { name: v });
      setEditingName(false);
      await reload();
      await reloadGroups();
      void syncNow({ force: true });
      showToast(t('groups.infoUpdated'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  const saveDesc = async () => {
    setSavingDesc(true);
    try {
      await groupService.update(groupId, { description: descDraft.trim() || null });
      setEditingDesc(false);
      await reload();
      await reloadGroups();
      void syncNow({ force: true });
      showToast(t('groups.infoUpdated'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setSavingDesc(false);
    }
  };

  const togglePublic = async () => {
    if (!group) return;
    const next = !group.is_public;
    try {
      await groupService.update(groupId, { is_public: next });
      await reload();
      void syncNow({ force: true });
      showToast(next ? t('groups.nowPublic') : t('groups.nowPrivate'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  const toggleMute = async () => {
    if (!group) return;
    const next = !group.muted;
    try {
      await groupService.setMuted(groupId, next);
      await reload();
      await reloadGroups();
      void syncNow({ force: true });
      showToast(next ? t('groups.muted') : t('groups.unmuted'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  const resetInvite = () =>
    confirmAlert(
      t('groups.resetInviteTitle'),
      t('groups.resetInviteBody'),
      async () => {
        const ok = await withOnline(() => groupService.resetInvite(groupId));
        if (ok) {
          await reload();
          showToast(t('groups.inviteReset'));
        }
      },
      { confirmText: t('groups.regenerate') },
    );

  const confirmDelete = () =>
    confirmAlert(
      t('groups.deleteTitle'),
      t('groups.deleteBody'),
      async () => {
        await groupService.remove(groupId);
        await reloadGroups();
        void syncNow({ force: true });
        navigation.navigate('Tabs', { screen: 'StatusTab' });
      },
      { destructive: true, confirmText: t('common.delete') },
    );

  const addMembers = () => {
    navigation.navigate('AddGroupMembers', { groupId });
  };

  /** Liste complète des membres dans un bottom sheet. Un tap sur un membre
   * ouvre son profil (photo, bio, présence) — avec les actions de gestion
   * (promouvoir / retirer) directement dedans si je suis admin/owner. */
  const openMembersSheet = () => {
    const sorted = [...members].sort((a, b) => {
      const order: Record<string, number> = { owner: 0, admin: 1, member: 2, subscriber: 2 };
      return (order[a.role] ?? 3) - (order[b.role] ?? 3);
    });
    showSheet({
      title:
        (isChannel ? t('groups.subscribers') : t('groups.members')) +
        ` (${sorted.length})`,
      actions: sorted.map((m) => {
        const nm = m.user.display_name || m.user.username || '—';
        const roleTag =
          m.role === 'owner'
            ? ` · ${t('groups.roleOwner')}`
            : m.role === 'admin'
              ? ` · ${t('groups.roleAdmin')}`
              : m.user.id === me?.id
                ? ` (${t('common.you')})`
                : '';
        return {
          label: nm + roleTag,
          icon: m.role === 'owner' || m.role === 'admin' ? 'shield-account-outline' : 'account-outline',
          onPress: () => {
            setTimeout(
              () =>
                navigation.navigate('UserProfile', {
                  userId: m.user.id,
                  name: nm,
                  avatar: m.user.avatar_url,
                  group: { groupId, role: m.role, isChannel, canManage: canEdit },
                }),
              250,
            );
          },
        };
      }),
    });
  };

  const shareInvite = async () => {
    if (!group) return;
    try {
      await Share.share({
        message: t('groups.shareInviteText', {
          name: group.name,
          link: inviteLink(group.invite_code),
        }),
      });
    } catch {
      /* annulé */
    }
  };

  /** Un seul bouton « Partager » -> choix entre lien et QR code. */
  const openShareSheet = () => {
    showSheet({
      title: isChannel ? t('groups.shareChannel') : t('groups.shareGroup'),
      actions: [
        {
          label: t('groups.inviteViaLink'),
          icon: 'link-variant',
          onPress: () => void shareInvite(),
        },
        {
          label: t('groups.inviteQr'),
          icon: 'qrcode',
          onPress: () => navigation.navigate('GroupQr', { groupId }),
        },
      ],
    });
  };

  const confirmLeave = () => {
    showAlert(
      isChannel ? t('groups.leaveChannelTitle') : t('groups.leaveGroupTitle'),
      t('groups.leaveConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.leave'),
          style: 'destructive',
          onPress: async () => {
            try {
              const ok = await withOnline(() => groupService.leave(groupId));
              if (ok === null) return; // hors-ligne
              await reloadGroups();
              navigation.navigate('Tabs', { screen: 'StatusTab' });
            } catch {
              showAlert(t('errors.generic'));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <Screen edges={[]}>
        <AppHeader
          variant="plain"
          title={t('groups.info')}
          left={
            <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
              <Icon name="chevron-left" size={28} color={c.primary} />
            </Pressable>
          }
        />
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={isChannel ? t('groups.channelInfo') : t('groups.groupInfo')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* en-tête */}
        <View style={styles.head}>
          <Pressable onPress={changeAvatar} disabled={!canEdit || picker.busy}>
            <Avatar uri={group?.avatar_url} name={group?.name} size={88} />
            {canEdit ? (
              <View style={[styles.avatarBadge, { backgroundColor: c.primary, borderColor: c.background }]}>
                {picker.busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Icon name="camera" size={14} color="#fff" />
                )}
              </View>
            ) : null}
          </Pressable>
          {editingName ? (
            <View style={styles.nameEdit}>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                maxLength={120}
                style={[styles.nameInput, { color: c.text, borderColor: c.border }]}
              />
              <View style={styles.descBtns}>
                <Pressable onPress={() => { setEditingName(false); setNameDraft(group?.name ?? ''); }}>
                  <Text style={[styles.descBtn, { color: c.textMuted }]}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={saveName}>
                  <Text style={[styles.descBtn, { color: c.primary, fontWeight: '800' }]}>
                    {t('common.save')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => canEdit && setEditingName(true)}
              disabled={!canEdit}
              style={styles.nameRow}
            >
              <Text style={[styles.name, { color: c.text }]}>{group?.name}</Text>
              {canEdit ? <Icon name="pencil-outline" size={15} color={c.textFaint} /> : null}
            </Pressable>
          )}
          {isChannel ? (
            <View style={styles.channelMetaRow}>
              <View style={styles.channelBadge}>
                <Icon name="bullhorn-variant" size={13} color={c.primary} />
                <Text style={[styles.channelBadgeTxt, { color: c.primary }]}>
                  {group?.is_public ? t('groups.publicChannel') : t('groups.privateChannel')}
                </Text>
              </View>
              <Text style={[styles.channelSubCount, { color: c.text }]}>
                {t('groups.subscribersCount', { count: group?.member_count ?? 0 })}
              </Text>
            </View>
          ) : (
            <View style={styles.kindTag}>
              <Icon name="account-multiple" size={13} color={c.textMuted} />
              <Text style={[styles.kindText, { color: c.textMuted }]}>
                {t('groups.membersCount', { count: group?.member_count ?? 0 })}
              </Text>
            </View>
          )}

          {editingDesc ? (
            <View style={styles.descEdit}>
              <TextInput
                value={descDraft}
                onChangeText={setDescDraft}
                placeholder={t('groups.descriptionPlaceholder')}
                placeholderTextColor={c.textFaint}
                multiline
                maxLength={2000}
                style={[styles.descInput, { color: c.text, borderColor: c.border }]}
              />
              <View style={styles.descBtns}>
                <Pressable onPress={() => { setEditingDesc(false); setDescDraft(group?.description ?? ''); }}>
                  <Text style={[styles.descBtn, { color: c.textMuted }]}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={saveDesc} disabled={savingDesc}>
                  <Text style={[styles.descBtn, { color: c.primary, fontWeight: '800' }]}>
                    {savingDesc ? t('common.loading') : t('common.save')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => canEdit && setEditingDesc(true)}
                disabled={!canEdit}
                style={styles.descRow}
              >
                <Text
                  style={[styles.desc, { color: group?.description ? c.textMuted : c.textFaint }]}
                  numberOfLines={descExpanded ? undefined : 3}
                  onTextLayout={(e) => {
                    if (!descExpanded && e.nativeEvent.lines.length > 3) setDescTruncated(true);
                  }}
                >
                  {group?.description || (canEdit ? t('groups.addDescription') : '')}
                </Text>
                {canEdit ? <Icon name="pencil-outline" size={14} color={c.textFaint} /> : null}
              </Pressable>
              {descTruncated ? (
                <Pressable onPress={() => setDescExpanded((v) => !v)} hitSlop={8}>
                  <Text style={[styles.descMore, { color: c.primary }]}>
                    {descExpanded ? t('common.seeLess') : t('common.seeMore')}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {/* réglages rapides */}
        <View style={[styles.toggleCard, { backgroundColor: c.surfaceAlt }]}>
          <Pressable
            style={[styles.manageRow, { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={() =>
              navigation.navigate('ChatSearch', {
                mode: 'group',
                groupId,
                groupName: group?.name ?? '',
              })
            }
            android_ripple={{ color: c.surface }}
          >
            <Icon name="magnify" size={20} color={c.primary} />
            <Text style={[styles.manageTxt, { flex: 1 }, { color: c.text }]}>{t('chat.search')}</Text>
            <Icon name="chevron-right" size={20} color={c.textFaint} />
          </Pressable>
          <Pressable style={styles.toggleRow} onPress={toggleMute}>
            <Icon
              name={group?.muted ? 'bell-off-outline' : 'bell-outline'}
              size={20}
              color={c.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: c.text }]}>
                {isChannel ? t('groups.muteChannel') : t('chat.mute')}
              </Text>
              <Text style={[styles.toggleSub, { color: c.textMuted }]}>
                {isChannel ? t('groups.muteChannelDesc') : t('chat.muteDesc')}
              </Text>
            </View>
            <View
              style={[
                styles.switch,
                { backgroundColor: group?.muted ? c.primary : c.border },
              ]}
            >
              <View style={[styles.knob, group?.muted && styles.knobOn]} />
            </View>
          </Pressable>
          {isChannel && canEdit ? (
            <Pressable
              style={[styles.toggleRow, { borderTopColor: c.divider, borderTopWidth: StyleSheet.hairlineWidth }]}
              onPress={togglePublic}
            >
              <Icon name="earth" size={20} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleLabel, { color: c.text }]}>
                  {t('groups.publicChannel')}
                </Text>
                <Text style={[styles.toggleSub, { color: c.textMuted }]}>
                  {t('groups.publicChannelHint')}
                </Text>
              </View>
              <View
                style={[
                  styles.switch,
                  { backgroundColor: group?.is_public ? c.primary : c.border },
                ]}
              >
                <View style={[styles.knob, group?.is_public && styles.knobOn]} />
              </View>
            </Pressable>
          ) : null}
        </View>

        {isChannel ? (
          /* ─────────── PROFIL DE CHAÎNE ─────────── */
          <>
            {/* Partager — un seul bouton, ouvre le choix lien / QR */}
            <Pressable
              onPress={openShareSheet}
              style={[styles.action, { backgroundColor: c.primary, marginTop: 10 }]}
              android_ripple={{ color: c.surface }}
            >
              <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Icon name="share-variant" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: '#fff' }]}>
                  {t('groups.shareChannel')}
                </Text>
                <Text style={[styles.actionSub, { color: 'rgba(255,255,255,0.85)' }]} numberOfLines={1}>
                  {inviteLink(group?.invite_code ?? '')}
                </Text>
              </View>
            </Pressable>

            {/* Bloc admin : gérer la chaîne */}
            {canEdit ? (
              <>
                <Text style={[styles.section, { color: c.textFaint }]}>
                  {t('groups.manageChannel')}
                </Text>
                <View style={[styles.toggleCard, { backgroundColor: c.surfaceAlt, marginTop: 0 }]}>
                  <Pressable
                    onPress={() => navigation.navigate('GroupSettings', { groupId })}
                    style={styles.manageRow}
                    android_ripple={{ color: c.surface }}
                  >
                    <Icon name="cog-outline" size={20} color={c.primary} />
                    <Text style={[styles.manageTxt, { flex: 1 }, { color: c.text }]}>
                      {t('groupSettings.channelTitle')}
                    </Text>
                    {(group?.pending_requests ?? 0) > 0 ? (
                      <View style={[styles.reqBadge, { backgroundColor: c.primary }]}>
                        <Text style={styles.reqBadgeTxt}>{group?.pending_requests}</Text>
                      </View>
                    ) : null}
                    <Icon name="chevron-right" size={20} color={c.textFaint} />
                  </Pressable>
                  <Pressable
                    onPress={openMembersSheet}
                    style={[styles.manageRow, { borderTopColor: c.divider, borderTopWidth: StyleSheet.hairlineWidth }]}
                    android_ripple={{ color: c.surface }}
                  >
                    <Icon name="account-group-outline" size={20} color={c.primary} />
                    <Text style={[styles.manageTxt, { flex: 1 }, { color: c.text }]}>
                      {t('groups.subscribers')} · {group?.member_count ?? members.length}
                    </Text>
                    <Icon name="chevron-right" size={20} color={c.textFaint} />
                  </Pressable>
                  <Pressable
                    onPress={addMembers}
                    style={[styles.manageRow, { borderTopColor: c.divider, borderTopWidth: StyleSheet.hairlineWidth }]}
                    android_ripple={{ color: c.surface }}
                  >
                    <Icon name="account-plus-outline" size={20} color={c.primary} />
                    <Text style={[styles.manageTxt, { flex: 1 }, { color: c.text }]}>{t('groups.addSubscribers')}</Text>
                    <Icon name="chevron-right" size={20} color={c.textFaint} />
                  </Pressable>
                  <Pressable
                    onPress={resetInvite}
                    style={[styles.manageRow, { borderTopColor: c.divider, borderTopWidth: StyleSheet.hairlineWidth }]}
                    android_ripple={{ color: c.surface }}
                  >
                    <Icon name="refresh" size={19} color={c.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.manageTxt, { color: c.textMuted }]}>
                        {t('groups.resetInvite')}
                      </Text>
                      <Text style={[styles.manageSub, { color: c.textFaint }]}>
                        {t('groups.resetInviteDesc')}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </>
            ) : null}
          </>
        ) : (
          /* ─────────── PROFIL DE GROUPE ─────────── */
          <>
            {/* Partager — un seul bouton, ouvre le choix lien / QR */}
            <Pressable
              onPress={openShareSheet}
              style={[styles.action, { backgroundColor: c.surfaceAlt }]}
              android_ripple={{ color: c.surface }}
            >
              <View style={[styles.actionIcon, { backgroundColor: c.primary }]}>
                <Icon name="share-variant" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: c.text }]}>
                  {t('groups.shareGroup')}
                </Text>
                <Text style={[styles.actionSub, { color: c.textMuted }]} numberOfLines={1}>
                  {inviteLink(group?.invite_code ?? '')}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={c.textMuted} />
            </Pressable>

            {/* Membres : une seule ligne -> bottom sheet avec la liste */}
            <Pressable
              onPress={openMembersSheet}
              style={styles.linkRow}
              android_ripple={{ color: c.surfaceAlt }}
            >
              <Icon name="account-multiple-outline" size={20} color={c.primary} />
              <Text style={[styles.linkTxt, { color: c.text, flex: 1, fontWeight: '600' }]}>
                {t('groups.members')} · {group?.member_count ?? members.length}
              </Text>
              <Icon name="chevron-right" size={22} color={c.textFaint} />
            </Pressable>

            {canEdit ? (
              <Pressable onPress={addMembers} style={styles.linkRow} android_ripple={{ color: c.surfaceAlt }}>
                <Icon name="account-plus-outline" size={20} color={c.primary} />
                <Text style={[styles.linkTxt, { color: c.primary }]}>{t('groups.addMembers')}</Text>
              </Pressable>
            ) : null}

            {canEdit ? (
              <Pressable
                onPress={() => navigation.navigate('GroupSettings', { groupId })}
                style={styles.linkRow}
                android_ripple={{ color: c.surfaceAlt }}
              >
                <Icon name="cog-outline" size={20} color={c.primary} />
                <Text style={[styles.linkTxt, { color: c.text, flex: 1, fontWeight: '600' }]}>
                  {t('groupSettings.title')}
                </Text>
                {(group?.pending_requests ?? 0) > 0 ? (
                  <View style={[styles.reqBadge, { backgroundColor: c.primary }]}>
                    <Text style={styles.reqBadgeTxt}>{group?.pending_requests}</Text>
                  </View>
                ) : null}
                <Icon name="chevron-right" size={22} color={c.textFaint} />
              </Pressable>
            ) : null}

            {canEdit ? (
              <Pressable onPress={resetInvite} style={styles.linkRow}>
                <Icon name="refresh" size={17} color={c.textMuted} />
                <Text style={[styles.linkTxt, { color: c.textMuted }]}>
                  {t('groups.resetInvite')}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}

        {/* quitter */}
        <Pressable
          onPress={confirmLeave}
          style={[styles.leaveBtn, { borderColor: c.danger }]}
          android_ripple={{ color: c.surfaceAlt }}
        >
          <Icon name="logout" size={18} color={c.danger} />
          <Text style={[styles.leaveText, { color: c.danger }]}>
            {isChannel ? t('groups.leaveChannel') : t('groups.leaveGroup')}
          </Text>
        </Pressable>

        {isOwner ? (
          <Pressable
            onPress={confirmDelete}
            style={[styles.leaveBtn, { borderColor: c.danger, marginTop: 10 }]}
            android_ripple={{ color: c.surfaceAlt }}
          >
            <Icon name="trash-can-outline" size={18} color={c.danger} />
            <Text style={[styles.leaveText, { color: c.danger }]}>
              {isChannel ? t('groups.deleteChannel') : t('groups.deleteGroup')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40 },
  head: { alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 30 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 21, fontWeight: '800', textAlign: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEdit: { alignSelf: 'stretch', gap: 6 },
  nameInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  channelMetaRow: { alignItems: 'center', gap: 8, marginTop: 2 },
  channelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(46,155,255,0.12)',
  },
  channelBadgeTxt: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  channelSubCount: { fontSize: 15, fontWeight: '700' },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  manageTxt: { fontSize: 14.5, fontWeight: '600' },
  manageSub: { fontSize: 12, marginTop: 1 },
  toggleCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleLabel: { fontSize: 14.5, fontWeight: '600' },
  toggleSub: { fontSize: 12, marginTop: 1 },
  switch: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 16,
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnTxt: { fontSize: 13, fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 18,
  },
  linkTxt: { fontSize: 13, fontWeight: '600' },
  reqBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  kindText: { fontSize: 13, fontWeight: '600' },
  desc: { fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  descMore: { fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  descRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  descEdit: { alignSelf: 'stretch', marginTop: 8, gap: 6 },
  descInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  descBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  descBtn: { fontSize: 14, fontWeight: '600' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
  },
  actionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 14, fontWeight: '700' },
  actionSub: { fontSize: 12, marginTop: 2 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginLeft: 18,
    marginBottom: 6,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberRole: { fontSize: 12, fontWeight: '700', marginTop: 1 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 28,
    paddingVertical: 13,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  leaveText: { fontSize: 15, fontWeight: '800' },
});
