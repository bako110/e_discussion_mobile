/** FAQ / centre d'aide — contenu statique natif, questions dépliables. */
import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];

export const FaqSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === key ? null : key));
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.faq')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {FAQ_KEYS.map((key, i) => {
            const isOpen = open === key;
            return (
              <View
                key={key}
                style={[
                  i < FAQ_KEYS.length - 1 && {
                    borderBottomColor: c.divider,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Pressable
                  onPress={() => toggle(key)}
                  android_ripple={{ color: c.surfaceAlt }}
                  style={styles.qRow}
                >
                  <Text style={[styles.qTxt, { color: c.text }]}>{t(`faq.${key}_q`)}</Text>
                  <Icon
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={c.textFaint}
                  />
                </Pressable>
                {isOpen ? (
                  <Text style={[styles.aTxt, { color: c.textMuted }]}>{t(`faq.${key}_a`)}</Text>
                ) : null}
              </View>
            );
          })}
        </View>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('faq.stillNeedHelp')}</Text>
        <Pressable onPress={() => navigation.navigate('ContactUs')}>
          <Text style={[styles.contactLink, { color: c.primary }]}>{t('settings.contactUs')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  qTxt: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  aTxt: { fontSize: 13.5, lineHeight: 20, paddingHorizontal: 14, paddingBottom: 16 },
  note: { fontSize: 13, textAlign: 'center', marginTop: 22 },
  contactLink: { fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 8 },
});
