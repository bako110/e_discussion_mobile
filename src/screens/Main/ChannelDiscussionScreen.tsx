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

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showToast } from '@/components/common';
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
            <>
              <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
                {t('groupSettings.discussionLinkedCount', {
                  count: linked.length,
                  max: MAX_DISCUSSION_CHANNELS,
                })}
              </Text>
              {linked.map((d) => (
                <Pressable
                  key={d.id}
                  style={[
                    styles.card,
                    { backgroundColor: c.card, borderColor: c.border, shadowColor: c.text },
                  ]}
                  android_ripple={{ color: c.surfaceAlt }}
                  onPress={() => navigation.navigate('GroupChat', { groupId: d.id, name: d.name })}
                >
                  <View>
                    <Avatar uri={d.avatar_url} name={d.name} size={52} />
                    <View style={[styles.kindDot, { backgroundColor: c.primary, borderColor: c.card }]}>
                      <Icon name="bullhorn" size={11} color="#fff" />
                    </View>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={[styles.cardName, { color: c.text }]} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <Icon name="account-multiple-outline" size={12} color={c.textFaint} />
                      <Text style={[styles.metaTxt, { color: c.textFaint }]}>
                        {t('groups.membersCount', { count: d.member_count })}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </>
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
                description={t('groupSettings.discussionCreateNewDesc')}
                onPress={() => setMode('new')}
              />
              <SettingsRow
                icon="format-list-bulleted"
                label={t('groupSettings.discussionPickExisting')}
                description={t('groupSettings.discussionPickExistingDesc')}
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
    marginLeft: 2,
  },
  // même style de carte que la liste principale des chaînes (GroupsListScreen)
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 5,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 1,
    shadowOpacity: 0.06,
  },
  kindDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  cardBody: { flex: 1, justifyContent: 'center' },
  cardName: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  metaTxt: { fontSize: 11.5, fontWeight: '600' },
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
