import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import {
  CHAT_WALLPAPERS,
  useChatPrefs,
  type FontSize,
} from '@/context/ChatPrefsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];

export const ChatsSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const {
    fontSize,
    fontScale,
    wallpaper,
    enterToSend,
    setFontSize,
    setWallpaperKey,
    setEnterToSend,
  } = useChatPrefs();
  const soon = (title: string) => Alert.alert(title, t('settings.comingSoon'));

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.chats')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Taille de police */}
        <SettingsSection title={t('settings.display')}>
          <View style={styles.block}>
            <Text style={[styles.blockLabel, { color: c.text }]}>{t('settings.fontSize')}</Text>
            <View style={styles.segment}>
              {FONT_SIZES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setFontSize(s)}
                  style={[
                    styles.segBtn,
                    { borderColor: c.border },
                    fontSize === s && { backgroundColor: c.primary, borderColor: c.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.segText,
                      { color: fontSize === s ? '#fff' : c.text },
                    ]}
                  >
                    {t(`settings.font_${s}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={[styles.preview, { backgroundColor: c.surfaceAlt }]}>
              <View style={[styles.bubble, { backgroundColor: c.bubbleOut }]}>
                <Text style={{ color: c.bubbleOutText, fontSize: 15 * fontScale }}>
                  {t('settings.fontPreview')}
                </Text>
              </View>
            </View>
          </View>
        </SettingsSection>

        {/* Fond d'écran */}
        <SettingsSection title={t('settings.wallpaper')}>
          <View style={styles.wallGrid}>
            {CHAT_WALLPAPERS.map((w) => {
              const bg =
                w.key === 'default'
                  ? c.chatBackground
                  : w.type === 'solid'
                    ? w.colors[0]
                    : w.colors[0];
              const selected = wallpaper.key === w.key;
              return (
                <Pressable
                  key={w.key}
                  onPress={() => setWallpaperKey(w.key)}
                  style={[
                    styles.wallSwatch,
                    { backgroundColor: bg, borderColor: selected ? c.primary : c.border },
                    selected && styles.wallSelected,
                  ]}
                >
                  {w.type === 'gradient' ? (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: w.colors[1], opacity: 0.5, borderRadius: 10 },
                      ]}
                    />
                  ) : null}
                  {selected ? (
                    <Icon name="check-circle" size={20} color={c.primary} />
                  ) : w.key === 'default' ? (
                    <Text style={[styles.wallLabel, { color: c.textMuted }]}>
                      {t('settings.wallpaperDefault')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </SettingsSection>

        {/* Comportement */}
        <SettingsSection title={t('settings.behavior')}>
          <View style={[styles.toggleRow, { borderBottomColor: c.divider }]}>
            <Icon name="keyboard-return" size={20} color={c.textMuted} />
            <Text style={[styles.toggleLabel, { color: c.text }]}>
              {t('settings.enterToSend')}
            </Text>
            <Switch
              value={enterToSend}
              onValueChange={setEnterToSend}
              trackColor={{ true: c.primary, false: c.border }}
              thumbColor="#fff"
            />
          </View>
          <SettingsRow
            icon="cloud-upload-outline"
            label={t('settings.chatBackup')}
            value={t('settings.never')}
            onPress={() => soon(t('settings.chatBackup'))}
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.chatsNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  block: { padding: 14, gap: 12 },
  blockLabel: { fontSize: 15, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  segText: { fontSize: 13, fontWeight: '700' },
  preview: { borderRadius: 12, padding: 12, alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  wallGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12 },
  wallSwatch: {
    width: 76,
    height: 96,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wallSelected: { borderWidth: 3 },
  wallLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center', paddingHorizontal: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
