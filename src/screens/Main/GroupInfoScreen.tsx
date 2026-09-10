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
    await groupService.update(groupId, { avatar_url: up.url });
    await reload();
    await reloadGroups();
    void syncNow({ force: true });
  };

  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === group?.name) {
      setEditingName(false);
      return;
    }
    await groupService.update(groupId, { name: v });
    setEditingName(false);
    await reload();
    await reloadGroups();
    void syncNow({ force: true });
  };

  const saveDesc = async () => {
    setSavingDesc(true);
    try {
      await groupService.update(groupId, { description: descDraft.trim() || null });
      setEditingDesc(false);
      await reload();
      await reloadGroups();
      void syncNow({ force: true });
    } finally {
      setSavingDesc(false);
    }
  };

  const togglePublic = async () => {
    if (!group) return;
    await groupService.update(groupId, { is_public: !group.is_public });
    await reload();
    void syncNow({ force: true });
  };

  const toggleMute = async () => {
    if (!group) return;
    await groupService.setMuted(groupId, !group.muted);
    await reload();
    await reloadGroups();
    void syncNow({ force: true });
  };

  const resetInvite = () =>
    confirmAlert(
      t('groups.resetInviteTitle'),
      t('groups.resetInviteBody'),
      async () => {
        const ok = await withOnline(() => groupService.resetInvite(groupId));
        if (ok) {
          await reload();
          showAlert(t('groups.inviteReset'));
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

  /** Actions sur un membre (appui long) — réservé owner/admin. */
  const onMemberPress = (m: GroupMember) => {
    if (!canEdit || m.user.id === me?.id || m.role === 'owner') return;
    const actions: { label: string; icon: string; destructive?: boolean; onPress: () => void }[] =
      [];
    if (isOwner) {
      if (m.role === 'admin') {
        actions.push({
          label: t('groups.demoteAdmin'),
          icon: 'shield-off-outline',
          onPress: () =>
            void groupService
              .setMemberRole(groupId, m.user.id, isChannel ? 'subscriber' : 'member')
              .then(() => syncNow({ force: true }))
              .then(reload),
        });
      } else {
        actions.push({
          label: t('groups.promoteAdmin'),
          icon: 'shield-account-outline',
          onPress: () =>
            void groupService
              .setMemberRole(groupId, m.user.id, 'admin')
              .then(() => syncNow({ force: true }))
              .then(reload),
        });
      }
    }
    actions.push({
      label: isChannel ? t('groups.removeSubscriber') : t('groups.removeMember'),
      icon: 'account-remove-outline',
      destructive: true,
      onPress: () =>
        void groupService
          .removeMember(groupId, m.user.id)
          .then(() => syncNow({ force: true }))
          .then(reload),
    });
    showSheet({
      title: m.user.display_name || m.user.username || '—',
      actions,
    });
  };

  const addMembers = () => {
    navigation.navigate('AddGroupMembers', { groupId });
  };

  /** Liste complète des membres dans un bottom sheet. Un tap sur un membre
   * (si admin) ré-ouvre le sheet d'actions le concernant. */
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
            if (canEdit && m.user.id !== me?.id && m.role !== 'owner') {
              setTimeout(() => onMemberPress(m), 250);
            }
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
        title={t('groups.info')}
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
          <View style={styles.kindTag}>
            <Icon
              name={isChannel ? 'bullhorn' : 'account-multiple'}
              size={13}
              color={c.textMuted}
            />
            <Text style={[styles.kindText, { color: c.textMuted }]}>
              {isChannel
                ? t('groups.subscribersCount', { count: group?.member_count ?? 0 })
                : t('groups.membersCount', { count: group?.member_count ?? 0 })}
            </Text>
          </View>

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
            <Pressable
              onPress={() => canEdit && setEditingDesc(true)}
              disabled={!canEdit}
              style={styles.descRow}
            >
              <Text
                style={[styles.desc, { color: group?.description ? c.textMuted : c.textFaint }]}
              >
                {group?.description || (canEdit ? t('groups.addDescription') : '')}
              </Text>
              {canEdit ? <Icon name="pencil-outline" size={14} color={c.textFaint} /> : null}
            </Pressable>
          )}
        </View>

        {/* réglages rapides */}
        <View style={[styles.toggleCard, { backgroundColor: c.surfaceAlt }]}>
          <Pressable style={styles.toggleRow} onPress={toggleMute}>
            <Icon
              name={group?.muted ? 'bell-off-outline' : 'bell-outline'}
              size={20}
              color={c.textMuted}
            />
            <Text style={[styles.toggleLabel, { color: c.text }]}>
              {t('chat.mute')}
            </Text>
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

        {/* invitation : QR à scanner */}
        <Pressable
          onPress={() => navigation.navigate('GroupQr', { groupId })}
          style={[styles.action, { backgroundColor: c.surfaceAlt }]}
          android_ripple={{ color: c.surface }}
        >
          <View style={[styles.actionIcon, { backgroundColor: c.primary }]}>
            <Icon name="qrcode" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: c.text }]}>
              {t('groups.inviteQr')}
            </Text>
            <Text style={[styles.actionSub, { color: c.textMuted }]} numberOfLines={1}>
              {t('groups.qrHint')}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={c.textMuted} />
        </Pressable>

        {/* invitation : partage du lien */}
        <Pressable
          onPress={shareInvite}
          style={[styles.action, { backgroundColor: c.surfaceAlt, marginTop: 6 }]}
          android_ripple={{ color: c.surface }}
        >
          <View style={[styles.actionIcon, { backgroundColor: c.accent }]}>
            <Icon name="link-variant" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: c.text }]}>
              {t('groups.inviteViaLink')}
            </Text>
            <Text style={[styles.actionSub, { color: c.textMuted }]} numberOfLines={1}>
              {inviteLink(group?.invite_code ?? '')}
            </Text>
          </View>
          <Icon name="share-variant" size={18} color={c.primary} />
        </Pressable>

        {/* Membres : une seule ligne -> bottom sheet avec la liste */}
        <Pressable
          onPress={openMembersSheet}
          style={styles.linkRow}
          android_ripple={{ color: c.surfaceAlt }}
        >
          <Icon name="account-multiple-outline" size={20} color={c.primary} />
          <Text style={[styles.linkTxt, { color: c.text, flex: 1, fontWeight: '600' }]}>
            {isChannel ? t('groups.subscribers') : t('groups.members')} ·{' '}
            {group?.member_count ?? members.length}
          </Text>
          <Icon name="chevron-right" size={22} color={c.textFaint} />
        </Pressable>

        {canEdit ? (
          <Pressable onPress={addMembers} style={styles.linkRow} android_ripple={{ color: c.surfaceAlt }}>
            <Icon name="account-plus-outline" size={20} color={c.primary} />
            <Text style={[styles.linkTxt, { color: c.primary }]}>{t('groups.addMembers')}</Text>
          </Pressable>
        ) : null}

        {/* Paramètres du groupe (admins) */}
        {canEdit ? (
          <Pressable
            onPress={() => navigation.navigate('GroupSettings', { groupId })}
            style={styles.linkRow}
            android_ripple={{ color: c.surfaceAlt }}
          >
            <Icon name="cog-outline" size={20} color={c.primary} />
            <Text style={[styles.linkTxt, { color: c.text, flex: 1, fontWeight: '600' }]}>
              {isChannel ? t('groupSettings.channelTitle') : t('groupSettings.title')}
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
  toggleCard: { marginHorizontal: 16, marginTop: 14, borderRadius: 14, overflow: 'hidden' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleLabel: { flex: 1, fontSize: 14.5, fontWeight: '600' },
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
