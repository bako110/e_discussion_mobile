/** Formulaire « Nous contacter » : motif + message -> e-mail support prérempli. */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Button, Icon, Screen, TextField, showToast } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

const SUPPORT_EMAIL = 'support@e-discussion.app';

type Topic = 'bug' | 'account' | 'suggestion' | 'other';
const TOPICS: Topic[] = ['bug', 'account', 'suggestion', 'other'];

export const ContactUsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const c = theme.colors;

  const [topic, setTopic] = useState<Topic>('bug');
  const [message, setMessage] = useState('');

  const send = () => {
    if (!message.trim()) return;
    const subject = t(`contactUs.topic_${topic}`);
    const bodyLines = [
      message.trim(),
      '',
      '---',
      me?.username ? `@${me.username}` : '',
      me?.id ? `ID: ${me.id}` : '',
    ].filter(Boolean);
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    Linking.openURL(url)
      .then(() => navigation.goBack())
      .catch(() => showToast(t('errors.generic'), { type: 'error' }));
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.contactUs')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.textMuted }]}>{t('contactUs.intro')}</Text>

          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{t('contactUs.topic')}</Text>
          <View style={styles.topicRow}>
            {TOPICS.map((tp) => {
              const selected = topic === tp;
              return (
                <Pressable
                  key={tp}
                  onPress={() => setTopic(tp)}
                  style={[
                    styles.topicChip,
                    {
                      backgroundColor: selected ? c.primary : c.surfaceAlt,
                      borderColor: selected ? c.primary : c.border,
                    },
                  ]}
                >
                  <Text style={[styles.topicTxt, { color: selected ? c.onPrimary : c.text }]}>
                    {t(`contactUs.topic_${tp}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: c.textMuted, marginTop: 18 }]}>
            {t('contactUs.messageLabel')}
          </Text>
          <TextField
            placeholder={t('contactUs.messagePlaceholder')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={2000}
            style={styles.messageInput}
          />

          <Button
            label={t('contactUs.send')}
            onPress={send}
            disabled={!message.trim()}
            style={styles.sendBtn}
          />
          <Text style={[styles.hint, { color: c.textFaint }]}>{t('contactUs.hint', { email: SUPPORT_EMAIL })}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 13.5, lineHeight: 19, marginBottom: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  topicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topicChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  topicTxt: { fontSize: 13, fontWeight: '600' },
  messageInput: { height: 140, textAlignVertical: 'top', paddingTop: 12 },
  sendBtn: { marginTop: 8 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 17 },
});
