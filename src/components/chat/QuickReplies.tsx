/**
 * Écran vide d'une conversation — petit bloc d'accueil chiffré + puces de
 * réponse rapide contextualisées (heure de la journée, première prise de
 * contact). Toucher une puce envoie le message aussitôt.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  partnerName: string;
  onSend: (text: string) => void;
}

export const QuickReplies: React.FC<Props> = ({ partnerName, onSend }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const suggestions = useMemo(() => {
    const h = new Date().getHours();
    const greet = h < 12 ? '🌅 Bonjour' : h < 18 ? '👋 Bonjour' : '🌙 Bonsoir';
    return [
      greet,
      t('chat.quickHello'),
      t('chat.quickHowAreYou'),
      t('chat.quickAvailable'),
      t('chat.quickWhatsUp'),
      t('chat.quickCallLater'),
      t('chat.quickNiceToMeet'),
    ];
  }, [t]);

  return (
    <View style={styles.root}>
      <View style={[styles.card, { backgroundColor: c.surfaceAlt }]}>
        <Icon name="lock-check" size={20} color={c.primary} />
        <Text style={[styles.title, { color: c.text }]}>{t('chat.emptyTitle')}</Text>
        <Text style={[styles.body, { color: c.textMuted }]}>
          {t('chat.emptyBody', { name: partnerName })}
        </Text>
      </View>

      <View style={styles.chips}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            onPress={() => onSend(s)}
            android_ripple={{ color: c.surfaceAlt }}
            style={[styles.chip, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Text style={[styles.chipText, { color: c.text }]}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // la FlatList est inversée → on remet le bloc à l'endroit
  root: { transform: [{ scaleY: -1 }], paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center' },
  card: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    maxWidth: 340,
    marginBottom: 22,
  },
  title: { fontSize: 15, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { fontSize: 13.5, fontWeight: '600' },
});
