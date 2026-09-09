/**
 * Paramètres des appels — sonnerie, vibreur, décrochage haut-parleur,
 * mode données réduites, blocage des appels d'inconnus.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsSection } from '@/components/settings';
import { useCall } from '@/context/CallContext';
import { useCallPrefs, type Ringtone } from '@/context/CallPrefsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

const RINGTONES: Ringtone[] = ['default', 'classic', 'soft'];

/** Ligne toggle réutilisable. */
const Toggle: React.FC<{
  icon: string;
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  last?: boolean;
}> = ({ icon, label, hint, value, onValueChange, last }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View
      style={[
        styles.toggleRow,
        !last && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name={icon} size={20} color={c.textMuted} />
      <View style={styles.toggleTxt}>
        <Text style={[styles.toggleLabel, { color: c.text }]}>{label}</Text>
        {hint ? <Text style={[styles.toggleHint, { color: c.textFaint }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: c.primary, false: c.border }}
        thumbColor="#fff"
      />
    </View>
  );
};

export const CallsSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const { available } = useCall();
  const {
    ringtone,
    vibrate,
    answerOnSpeaker,
    lowData,
    blockUnknown,
    setRingtone,
    setVibrate,
    setAnswerOnSpeaker,
    setLowData,
    setBlockUnknown,
  } = useCallPrefs();

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.calls')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!available ? (
          <View style={[styles.banner, { backgroundColor: c.surfaceAlt }]}>
            <Icon name="information-outline" size={16} color={c.textMuted} />
            <Text style={[styles.bannerTxt, { color: c.textMuted }]}>
              {t('calls.unavailableBody')}
            </Text>
          </View>
        ) : null}

        {/* Sonnerie */}
        <SettingsSection title={t('settings.ringtoneSection')}>
          <View style={styles.block}>
            <Text style={[styles.blockLabel, { color: c.text }]}>{t('settings.ringtone')}</Text>
            <View style={styles.segment}>
              {RINGTONES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRingtone(r)}
                  style={[
                    styles.segBtn,
                    { borderColor: c.border },
                    ringtone === r && { backgroundColor: c.primary, borderColor: c.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.segTxt,
                      { color: ringtone === r ? '#fff' : c.textMuted },
                    ]}
                  >
                    {t(`settings.ringtone_${r}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Toggle
            icon="vibrate"
            label={t('settings.vibrate')}
            value={vibrate}
            onValueChange={setVibrate}
            last
          />
        </SettingsSection>

        {/* Comportement */}
        <SettingsSection title={t('settings.behavior')}>
          <Toggle
            icon="volume-high"
            label={t('settings.answerOnSpeaker')}
            hint={t('settings.answerOnSpeakerHint')}
            value={answerOnSpeaker}
            onValueChange={setAnswerOnSpeaker}
          />
          <Toggle
            icon="signal-cellular-outline"
            label={t('settings.lowData')}
            hint={t('settings.lowDataHint')}
            value={lowData}
            onValueChange={setLowData}
          />
          <Toggle
            icon="account-cancel-outline"
            label={t('settings.blockUnknownCalls')}
            hint={t('settings.blockUnknownCallsHint')}
            value={blockUnknown}
            onValueChange={setBlockUnknown}
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.callsNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  bannerTxt: { fontSize: 12, flex: 1 },
  block: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomColor: 'transparent',
  },
  blockLabel: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  segTxt: { fontSize: 13, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  toggleTxt: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '500' },
  toggleHint: { fontSize: 12, marginTop: 2 },
  note: { fontSize: 12, lineHeight: 17, marginTop: 18, marginHorizontal: 4 },
});
