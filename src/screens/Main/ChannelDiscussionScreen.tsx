/**
 * Canaux de discussion liés à une chaîne (façon Telegram) : les abonnés
 * peuvent commenter les publications dans un canal séparé de la chaîne
 * principale. Jusqu'à 5 canaux liés en même temps (langues/sujets
 * différents) — créer un nouveau canal OU choisir un canal existant (dont
 * je suis owner/admin), délier un canal précis pour en changer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, confirmAlert, showToast } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { DiscussionChannel, Group } from '@/types';

const MAX_DISCUSSION_CHANNELS = 5;

export const ChannelDiscussionScreen: React.FC<MainScreenProps<'ChannelDiscussion'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload: reloadGroups } = useGroups();
  const c = theme.colors;

  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState<DiscussionChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'none' | 'new' | 'existing'>('none');
  const [newName, setNewName] = useState('');
  const [candidates, setCandidates] = useState<Group[]>([]);

  const load = useCallback(async () => {
    try {
      setLinked(await groupService.listDiscussions(groupId));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [groupId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const canAddMore = linked.length < MAX_DISCUSSION_CHANNELS;

  const openExisting = async () => {
    setMode('existing');
    const own = await groupService.list('channel');
    const linkedIds = new Set(linked.map((d) => d.id));
    setCandidates(own.filter((g) => g.id !== groupId && !linkedIds.has(g.id)));
  };

  const createNew = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await groupService.linkDiscussion(groupId, { newGroupName: name });
      void reloadGroups();
      showToast(t('groupSettings.discussionLinked'));
      setNewName('');
      setMode('none');
      void load();
    } catch {
      showToast(t('groupSettings.saveFailed'), { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const linkExisting = async (id: string) => {
    setBusy(true);
    try {
      await groupService.linkDiscussion(groupId, { existingGroupId: id });
      void reloadGroups();
      showToast(t('groupSettings.discussionLinked'));
      setMode('none');
      void load();
    } catch {
      showToast(t('groupSettings.saveFailed'), { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = (d: DiscussionChannel) => {
    confirmAlert(
      d.name,
      t('groupSettings.discussionUnlinkConfirm'),
      async () => {
        setBusy(true);
        try {
          await groupService.unlinkDiscussion(groupId, d.id);
          void reloadGroups();
          showToast(t('groupSettings.discussionUnlinked'));
          void load();
        } catch {
          showToast(t('groupSettings.saveFailed'), { type: 'error' });
        } finally {
          setBusy(false);
        }
      },
      { destructive: true, confirmText: t('common.delete'), cancelText: t('common.cancel') },
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('groupSettings.ch_discussion')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <View style={styles.body}>
          <Text style={[styles.hint, { color: c.textMuted }]}>
            {t('groupSettings.discussionHint')}
          </Text>

          {linked.length > 0 ? (
            <SettingsSection title={t('groupSettings.discussionLinkedCount', { count: linked.length, max: MAX_DISCUSSION_CHANNELS })}>
              {linked.map((d, i) => (
                <SettingsRow
                  key={d.id}
                  icon="message-reply-text-outline"
                  label={d.name}
                  value={t('groups.membersCount', { count: d.member_count })}
                  onPress={() =>
                    navigation.navigate('GroupChat', { groupId: d.id, name: d.name })
                  }
                  last={i === linked.length - 1 && mode === 'none'}
                />
              ))}
            </SettingsSection>
          ) : null}

          {linked.length > 0 ? (
            <View style={styles.unlinkList}>
              {linked.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() => unlink(d)}
                  disabled={busy}
                  style={styles.unlinkChip}
                >
                  <Icon name="link-off" size={14} color={c.danger} />
                  <Text style={[styles.unlinkChipTxt, { color: c.danger }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {mode === 'none' && canAddMore ? (
            <SettingsSection>
              <SettingsRow
                icon="plus-circle-outline"
                label={t('groupSettings.discussionCreateNew')}
                onPress={() => setMode('new')}
              />
              <SettingsRow
                icon="format-list-bulleted"
                label={t('groupSettings.discussionPickExisting')}
                onPress={() => void openExisting()}
                last
              />
            </SettingsSection>
          ) : mode === 'none' && !canAddMore ? (
            <Text style={[styles.hint, { color: c.textFaint }]}>
              {t('groupSettings.discussionMaxReached', { max: MAX_DISCUSSION_CHANNELS })}
            </Text>
          ) : mode === 'new' ? (
            <SettingsSection>
              <View style={styles.newRow}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('groupSettings.discussionNamePlaceholder')}
                  placeholderTextColor={c.textFaint}
                  style={[styles.input, { color: c.text, borderColor: c.border }]}
                  autoFocus
                  maxLength={120}
                />
                {busy ? (
                  <ActivityIndicator color={c.primary} />
                ) : (
                  <Pressable
                    onPress={() => void createNew()}
                    disabled={!newName.trim()}
                    style={[styles.createBtn, { backgroundColor: c.primary, opacity: newName.trim() ? 1 : 0.5 }]}
                  >
                    <Icon name="check" size={20} color="#fff" />
                  </Pressable>
                )}
              </View>
            </SettingsSection>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(g) => g.id}
              ListEmptyComponent={
                <Text style={[styles.hint, { color: c.textMuted }]}>
                  {t('groupSettings.discussionNoCandidates')}
                </Text>
              }
              renderItem={({ item }) => (
                <SettingsSection>
                  <SettingsRow
                    icon="bullhorn-outline"
                    label={item.name}
                    onPress={() => void linkExisting(item.id)}
                    last
                  />
                </SettingsSection>
              )}
            />
          )}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  body: { flex: 1, padding: 16 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  unlinkList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  unlinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 180,
  },
  unlinkChipTxt: { fontSize: 12.5, fontWeight: '600' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  createBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
