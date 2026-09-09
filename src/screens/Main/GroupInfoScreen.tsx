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

import { AppHeader, Avatar, Icon, Screen, showAlert } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useGroups } from '@/context/GroupsContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { Group, GroupMember } from '@/types';

/** Deep-link d'invitation encodé dans le QR / partagé par lien. */
export const inviteLink = (code: string) => `gofolyx://join/${code}`;

const ROLE_LABEL: Record<string, string> = {
  owner: 'groups.roleOwner',
  admin: 'groups.roleAdmin',
  member: 'groups.roleMember',
  subscriber: 'groups.roleSubscriber',
};

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

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [g, m] = await Promise.all([
          groupService.get(groupId),
          groupService.members(groupId),
        ]);
        if (alive) {
          setGroup(g);
          setMembers(m);
          setDescDraft(g.description ?? '');
        }
      } catch (e) {
        console.warn('[group] info failed:', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  const isChannel = group?.kind === 'channel';
  const canEdit = group?.my_role === 'owner' || group?.my_role === 'admin';

  const changeAvatar = () => {
    if (!canEdit) return;
    showAlert(t('settings.changePhoto'), undefined, [
      { text: t('stories.fromGallery'), onPress: () => void pickAvatar(false) },
      { text: t('stories.fromCamera'), onPress: () => void pickAvatar(true) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const pickAvatar = async (camera: boolean) => {
    const up = await picker.pickImage({ camera });
    if (!up) return;
    try {
      const g = await groupService.update(groupId, { avatar_url: up.url });
      setGroup(g);
      await reloadGroups();
    } catch {
      showAlert(t('errors.generic'));
    }
  };

  const saveDesc = async () => {
    setSavingDesc(true);
    try {
      const g = await groupService.update(groupId, {
        description: descDraft.trim() || null,
      });
      setGroup(g);
      setEditingDesc(false);
      await reloadGroups();
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setSavingDesc(false);
    }
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
              await groupService.leave(groupId);
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
          <Text style={[styles.name, { color: c.text }]}>{group?.name}</Text>
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

        {/* membres */}
        <Text style={[styles.section, { color: c.textMuted }]}>
          {isChannel ? t('groups.subscribers') : t('groups.members')}
        </Text>
        {members.map((m) => {
          const nm = m.user.display_name || m.user.username || '—';
          return (
            <View key={m.user.id} style={styles.memberRow}>
              <Avatar uri={m.user.avatar_url} name={nm} size={42} online={m.user.is_online} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>
                  {nm}
                  {m.user.id === me?.id ? ` (${t('common.you')})` : ''}
                </Text>
                {m.role !== 'member' && m.role !== 'subscriber' ? (
                  <Text style={[styles.memberRole, { color: c.primary }]}>
                    {t(ROLE_LABEL[m.role] ?? 'groups.roleMember')}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}

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
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
