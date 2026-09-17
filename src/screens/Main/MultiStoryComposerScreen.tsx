import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon, showAlert, showToast } from '@/components/common';
import { useStories } from '@/context/StoriesContext';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';
import type { MainScreenProps } from '@/navigation/types';
import { storyService } from '@/services';
import type { StoryAudienceMode } from '@/services/storyService';
import { openStoryPrivacySheet } from '@/services/storyPrivacySheet';
import type { StoryMediaType } from '@/types';

/** Une image en attente d'envoi dans le lot, avec sa légende propre. */
interface DraftItem {
  /** clé stable pour les listes/react — l'uri seule suffit (unique par asset). */
  key: string;
  local: LocalMediaFile;
  caption: string;
}

/**
 * Composeur multi-image (façon WhatsApp « partager plusieurs photos ») :
 * carrousel horizontal, une légende éditable par image, envoi de TOUTES les
 * images comme des stories SÉPARÉES en une seule action.
 *
 * Contrairement à `MediaEditorScreen`, pas de recadrage / dessin / stickers
 * ici — hors scope pour la première version multi-image (voir légende
 * obligatoire minimum). Chaque image part telle que sélectionnée dans la
 * galerie, avec sa légende.
 */
export const MultiStoryComposerScreen: React.FC<MainScreenProps<'MultiStoryComposer'>> = ({
  route,
  navigation,
}) => {
  const { locals } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { reload } = useStories();

  const [items, setItems] = useState<DraftItem[]>(() =>
    locals.map((local, i) => ({ key: `${local.file.uri}_${i}`, local, caption: '' })),
  );
  const [index, setIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const listRef = useRef<FlatList<DraftItem>>(null);

  const [audienceMode, setAudienceMode] = useState<StoryAudienceMode>(
    () => storyService.readAudienceCache().mode,
  );

  const current = items[index] ?? null;

  const setCaptionFor = useCallback((key: string, caption: string) => {
    setItems((all) => all.map((it) => (it.key === key ? { ...it, caption } : it)));
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((all) => {
      const removedAt = all.findIndex((it) => it.key === key);
      const next = all.filter((it) => it.key !== key);
      if (removedAt !== -1) {
        // ne recule l'index que si l'image retirée était AVANT ou À la page
        // courante — sinon la position affichée ne doit pas bouger.
        setIndex((i) => (removedAt <= i ? Math.max(0, Math.min(i, next.length - 1)) : i));
      }
      return next;
    });
  }, []);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setIndex(Math.max(0, Math.min(page, items.length - 1)));
  };

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(i, items.length - 1));
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
    setIndex(clamped);
  };

  // ── envoi : chaque image devient sa PROPRE story, en série (storyService
  // est local-first / synchrone — pas d'attente réseau réelle ici, l'upload
  // est différé et rejoué par l'outbox comme pour une image seule). ────────
  const publishAll = async () => {
    if (sending || items.length === 0) return;
    setSending(true);
    setSentCount(0);
    let failed = 0;
    for (const it of items) {
      try {
        const mediaType: StoryMediaType = it.local.kind === 'video' ? 'video' : 'image';
        storyService.createMedia(
          {
            media_type: mediaType,
            caption: it.caption.trim() || undefined,
            duration_sec:
              mediaType === 'video' ? Math.max(3, Math.round(it.local.durationSec ?? 15)) : 6,
          },
          it.local.file,
        );
        setSentCount((n) => n + 1);
      } catch (e) {
        console.warn('[multiStory] publish failed for one item:', e);
        failed += 1;
      }
    }
    setSending(false);
    await reload();

    if (failed === 0) {
      showToast(t('stories.multiSendDone', { count: items.length }));
      navigation.navigate('Tabs', { screen: 'StatusTab' });
    } else {
      const okCount = items.length - failed;
      showAlert(
        t('stories.multiSendPartialTitle'),
        t('stories.multiSendPartial', { ok: okCount, failed }),
      );
      navigation.navigate('Tabs', { screen: 'StatusTab' });
    }
  };

  const canSend = !sending && items.length > 0;

  const renderItem = useCallback(
    ({ item }: { item: DraftItem }) => (
      <View style={[styles.page, { width: screenWidth }]}>
        <Image source={{ uri: item.local.file.uri }} style={styles.image} resizeMode="contain" />
      </View>
    ),
    [screenWidth],
  );

  const keyExtractor = useCallback((it: DraftItem) => it.key, []);

  const dots = useMemo(() => items.map((it) => it.key), [items]);

  if (items.length === 0) {
    // toutes les images ont été retirées -> rien à composer, on ressort
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
            <Icon name="close" size={26} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t('stories.multiNoneLeft')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header : fermer + compteur position */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.counter}>
          {index + 1}/{items.length}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      {/* Carrousel plein écran */}
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: screenWidth, offset: screenWidth * i, index: i })}
        style={styles.carousel}
      />

      {/* Retirer l'image courante */}
      {current ? (
        <Pressable
          onPress={() => removeItem(current.key)}
          hitSlop={10}
          style={styles.removeBtn}
          disabled={sending}
        >
          <Icon name="trash-can-outline" size={20} color="#fff" />
        </Pressable>
      ) : null}

      {/* Indicateurs (points) — cliquables pour naviguer directement */}
      {items.length > 1 ? (
        <View style={styles.dotsRow} pointerEvents="box-none">
          {dots.map((key, i) => (
            <Pressable key={key} onPress={() => goTo(i)} hitSlop={6}>
              <View style={[styles.dot, i === index && styles.dotActive]} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Légende de l'image courante */}
      {current ? (
        <View style={styles.captionWrap}>
          <TextInput
            value={current.caption}
            onChangeText={(v) => setCaptionFor(current.key, v)}
            placeholder={t('stories.captionPlaceholder')}
            placeholderTextColor="#ffffffcc"
            maxLength={500}
            style={styles.captionInput}
            selectionColor="#fff"
            editable={!sending}
          />
        </View>
      ) : null}

      {/* Pied : confidentialité + envoyer */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          onPress={() =>
            openStoryPrivacySheet(() => setAudienceMode(storyService.readAudienceCache().mode))
          }
          style={styles.audienceBtn}
          disabled={sending}
        >
          <Icon
            name={
              audienceMode === 'only'
                ? 'account-lock-outline'
                : audienceMode === 'contacts_except'
                  ? 'account-cancel-outline'
                  : 'account-multiple-outline'
            }
            size={16}
            color="#fff"
          />
          <Text style={styles.audienceText}>{t(`storyPrivacy.mode_${audienceMode}`)}</Text>
        </Pressable>

        <Pressable
          onPress={publishAll}
          disabled={!canSend}
          style={[styles.send, { opacity: canSend ? 1 : 0.5 }]}
        >
          {sending ? (
            <>
              <ActivityIndicator color="#1E6FE0" />
              <Text style={styles.sendText}>
                {t('stories.multiSending', { sent: sentCount, total: items.length })}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.sendText}>
                {t('stories.multiSend', { count: items.length })}
              </Text>
              <Icon name="send" size={18} color="#1E6FE0" />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 52,
    zIndex: 10,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  counter: { color: '#fff', fontWeight: '700', fontSize: 15 },
  carousel: { flex: 1 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    right: 16,
    top: 64,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  dotActive: { backgroundColor: '#fff', transform: [{ scale: 1.3 }] },
  captionWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  captionInput: {
    color: '#fff',
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff55',
    paddingVertical: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  audienceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#ffffff66',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audienceText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendText: { color: '#1E6FE0', fontWeight: '800', fontSize: 14 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#fff', fontSize: 15, textAlign: 'center' },
});
