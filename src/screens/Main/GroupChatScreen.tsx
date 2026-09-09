import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, CachedImage, Icon, Screen, showAlert, showSheet } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useGroups } from '@/context/GroupsContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import { useTheme } from '@/context/ThemeContext';
import { useWs } from '@/context/WebSocketContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { LocalGroup, LocalGroupMessage } from '@/db/repositories/groupRepo';
import { onLocalMessageEvent } from '@/context/MessageSync';
import { groupRepo } from '@/db/repositories/groupRepo';
import { useSync } from '@/context/SyncContext';
import { syncNow } from '@/sync/syncEngine';
import { mediaUrl } from '@/utils/media';
import { clockTime, dayLabel } from '@/utils/time';

/**
 * Chat de groupe / chaîne — LOCAL-FIRST (comme le 1-to-1).
 *
 * - Lecture : `groupRepo` (SQLite). Hors-ligne, tout l'historique déjà
 *   téléchargé reste visible. Rafraîchissement serveur best-effort.
 * - Envoi : optimiste + outbox (`send_group_message` / `upload_group_message`),
 *   rejoué au retour du réseau.
 * - Groupe : tout membre écrit. Chaîne : seuls owner/admin publient.
 */
export const GroupChatScreen: React.FC<MainScreenProps<'GroupChat'>> = ({
  route,
  navigation,
}) => {
  const { groupId, name: initialName } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const { addListener } = useWs();
  const { reload: reloadGroups } = useGroups();
  const { online } = useSync();
  const picker = useMediaPicker();
  const c = theme.colors;
  const myId = me?.id ?? '';

  const [group, setGroup] = useState<LocalGroup | null>(null);
  const [messages, setMessages] = useState<LocalGroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  /** Lecture locale (instantanée, hors-ligne OK). */
  const reload = useCallback(async () => {
    const [g, hist] = await Promise.all([
      groupRepo.get(groupId),
      groupRepo.page(groupId, 60),
    ]);
    setGroup(g);
    setMessages(hist);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    void reload();
    // rafraîchissement serveur best-effort (silencieux si hors-ligne)
    void groupService.refreshMessages(groupId).then(reload).catch(() => undefined);
  }, [groupId, reload]);

  // marque lu à l'entrée / sortie (local + outbox)
  useFocusEffect(
    useCallback(() => {
      void groupService.markRead(groupId).then(reloadGroups).catch(() => undefined);
      return () => {
        void groupService.markRead(groupId).then(reloadGroups).catch(() => undefined);
      };
    }, [groupId, reloadGroups]),
  );

  // temps réel : l'ingestion est faite globalement par <MessageSync/> ; ici on
  // recharge la liste locale + on marque lu.
  useEffect(
    () =>
      onLocalMessageEvent((ev) => {
        if (ev.type === 'group' && ev.groupId === groupId) {
          void reload();
          void groupService.markRead(groupId).catch(() => undefined);
        }
      }),
    [groupId, reload],
  );

  // maj de l'entête (membres, infos) — pas géré par MessageSync
  useEffect(
    () =>
      addListener((e) => {
        if (
          (e.type === 'group.member' || e.type === 'group.updated') &&
          e.group_id === groupId
        ) {
          void groupService.refreshMessages(groupId).then(reload).catch(() => undefined);
        }
      }),
    [addListener, groupId, reload],
  );

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !group?.can_post) return;
    setText('');
    setSending(true);
    try {
      await groupService.send(groupId, body, { senderId: myId });
      await reload();
      void syncNow({ force: true });
      void reloadGroups();
    } catch (e) {
      console.warn('[group] send failed:', e);
      setText(body);
      showAlert(t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  const sendMedia = async (kind: 'photo' | 'video' | 'file') => {
    if (!group?.can_post) return;
    const local =
      kind === 'photo'
        ? await picker.pickImageLocal()
        : kind === 'video'
          ? await picker.pickVideoLocal()
          : await picker.pickDocumentLocal();
    if (!local) return;
    setSending(true);
    try {
      await groupService.sendMedia({
        groupId,
        senderId: myId,
        localFile: local.file,
        kind: local.kind,
        meta: {
          width: local.width ?? undefined,
          height: local.height ?? undefined,
          duration_sec: local.durationSec ?? undefined,
          size: local.size ?? undefined,
        },
      });
      await reload();
      void syncNow({ force: true });
      void reloadGroups();
    } catch (e) {
      console.warn('[group] media send failed:', e);
      showAlert(t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  const pickAttachment = () => {
    showSheet({
      title: t('groups.attach'),
      actions: [
        { label: t('groups.attachPhoto'), icon: 'image-multiple', onPress: () => void sendMedia('photo') },
        { label: t('groups.attachVideo'), icon: 'video', onPress: () => void sendMedia('video') },
        { label: t('chat.attachFile'), icon: 'file-document', onPress: () => void sendMedia('file') },
      ],
    });
  };

  // liste inversée + séparateurs de jour
  const data = [...messages].reverse();

  const renderItem = ({ item, index }: { item: LocalGroupMessage; index: number }) => {
    if (item.type === 'system') {
      return (
        <View style={styles.sysWrap}>
          <Text style={[styles.sysText, { backgroundColor: c.surfaceAlt, color: c.textMuted }]}>
            {item.body}
          </Text>
        </View>
      );
    }
    const mine = item.sender_id === myId;
    const senderName =
      item.sender?.display_name || item.sender?.username || (mine ? t('common.you') : '—');

    // séparateur de jour : quand le message plus ancien (index+1) change de date
    const older = data[index + 1];
    const showDay =
      !older ||
      new Date(item.created_at).toDateString() !== new Date(older.created_at).toDateString();

    return (
      <View>
        <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
          {!mine ? (
            <Avatar uri={item.sender?.avatar_url} name={senderName} size={28} />
          ) : null}
          <View
            style={[
              styles.bubble,
              mine
                ? { backgroundColor: c.bubbleOut, borderBottomRightRadius: 4 }
                : { backgroundColor: c.bubbleIn, borderBottomLeftRadius: 4 },
            ]}
          >
            {!mine ? (
              <Text style={[styles.sender, { color: c.primary }]} numberOfLines={1}>
                {senderName}
              </Text>
            ) : null}

            {item.attachment_url && (item.type === 'image' || item.type === 'video') ? (
              <Pressable
                onPress={() =>
                  navigation.navigate('MediaViewer', {
                    url: mediaUrl(item.attachment_url) ?? item.attachment_url!,
                    type: item.type === 'video' ? 'video' : 'image',
                    thumbnailUrl: mediaUrl(
                      item.attachment_meta?.thumbnail_url as string | undefined,
                    ),
                  })
                }
                style={styles.attachWrap}
              >
                <CachedImage
                  uri={
                    (item.attachment_meta?.thumbnail_url as string | undefined) ??
                    item.attachment_url ??
                    undefined
                  }
                  style={styles.attachImg}
                  resizeMode="cover"
                />
                {item.type === 'video' ? (
                  <View style={styles.attachPlay}>
                    <Icon name="play" size={22} color="#fff" />
                  </View>
                ) : null}
                {item.pending ? (
                  <View style={styles.attachPending}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
            ) : null}

            {item.body ? (
              <Text style={[styles.body, { color: mine ? c.bubbleOutText : c.bubbleInText }]}>
                {item.body}
              </Text>
            ) : null}
            <Text
              style={[
                styles.time,
                { color: mine ? 'rgba(255,255,255,0.75)' : c.textFaint },
              ]}
            >
              {item.pending ? t('common.loading') : clockTime(item.created_at)}
            </Text>
          </View>
        </View>
        {showDay ? (
          <View style={styles.dayWrap}>
            <Text style={[styles.dayText, { backgroundColor: c.surfaceAlt, color: c.textMuted }]}>
              {dayLabel(item.created_at)}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const title = group?.name || initialName;
  const canPost = group?.can_post ?? false;
  const isChannel = group?.kind === 'channel';

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        full={
          <View style={styles.hdr}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
              <Icon name="chevron-left" size={28} color={c.primary} />
            </Pressable>
            <Pressable
              style={styles.hdrCenter}
              onPress={() => navigation.navigate('GroupInfo', { groupId })}
            >
              <Avatar uri={group?.avatar_url} name={title} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.hdrTitle, { color: c.text }]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.hdrSub, { color: c.textMuted }]} numberOfLines={1}>
                  {isChannel
                    ? t('groups.subscribersCount', { count: group?.member_count ?? 0 })
                    : t('groups.membersCount', { count: group?.member_count ?? 0 })}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('GroupInfo', { groupId })}
              hitSlop={10}
            >
              <Icon name="dots-vertical" size={22} color={c.text} />
            </Pressable>
          </View>
        }
      />

      {!online ? (
        <View style={[styles.offlineStrip, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="cloud-off-outline" size={14} color={c.textMuted} />
          <Text style={[styles.offlineText, { color: c.textMuted }]}>{t('sync.offline')}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          <FlatList
            data={data}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="message-outline" size={30} color={c.textFaint} />
                <Text style={[styles.emptyText, { color: c.textMuted }]}>
                  {t('groups.noMessages')}
                </Text>
              </View>
            }
          />

          {canPost ? (
            <View
              style={[
                styles.composer,
                { paddingBottom: 8 + insets.bottom, backgroundColor: c.background, borderTopColor: c.divider },
              ]}
            >
              <Pressable
                onPress={pickAttachment}
                disabled={sending || picker.busy}
                style={styles.attachBtn}
                hitSlop={6}
              >
                {picker.busy ? (
                  <ActivityIndicator color={c.textMuted} size="small" />
                ) : (
                  <Icon name="paperclip" size={22} color={c.textMuted} />
                )}
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('groups.messagePlaceholder')}
                placeholderTextColor={c.textFaint}
                multiline
                style={[styles.composerInput, { backgroundColor: c.surface, color: c.text }]}
              />
              <Pressable
                onPress={send}
                disabled={!text.trim() || sending}
                style={[styles.sendBtn, { backgroundColor: c.primary, opacity: text.trim() && !sending ? 1 : 0.5 }]}
              >
                <Icon name="send" size={20} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.readOnly,
                { paddingBottom: 10 + insets.bottom, backgroundColor: c.surfaceAlt },
              ]}
            >
              <Icon name="eye-outline" size={16} color={c.textMuted} />
              <Text style={[styles.readOnlyText, { color: c.textMuted }]}>
                {t('groups.readOnlyChannel')}
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdr: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hdrCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hdrTitle: { fontSize: 16, fontWeight: '800' },
  hdrSub: { fontSize: 12, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  offlineStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
  },
  offlineText: { fontSize: 12, fontWeight: '600' },
  list: { padding: 12, gap: 3, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  sender: { fontSize: 12, fontWeight: '800', marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 20 },
  attachWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 4, position: 'relative' },
  attachImg: { width: 220, height: 220, backgroundColor: '#0002' },
  attachPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachPending: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { fontSize: 10, marginTop: 3, alignSelf: 'flex-end' },
  dayWrap: { alignItems: 'center', marginVertical: 8 },
  dayText: { fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  sysWrap: { alignItems: 'center', marginVertical: 6 },
  sysText: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 60, transform: [{ scaleY: -1 }] },
  emptyText: { fontSize: 13 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 15,
  },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  readOnlyText: { fontSize: 13, fontWeight: '600' },
});
