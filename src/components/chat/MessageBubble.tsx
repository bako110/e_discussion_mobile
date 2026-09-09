import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useChatPrefs } from '@/context/ChatPrefsContext';
import { useTheme } from '@/context/ThemeContext';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { clockTime } from '@/utils/time';

interface Props {
  message: LocalMessage;
  mine: boolean;
  grouped?: boolean; // suit un message du même expéditeur → coins/queue adaptés
  onLongPress?: () => void;
  onRetry?: () => void;
}

/** Coche d'état pour mes messages : en attente / envoyé / remis / lu / échec.
 * `readColor` : teinte accentuée quand le message est LU (double coche colorée
 * façon WhatsApp) ; le reste garde la teinte discrète `color`. */
const StatusTick: React.FC<{ m: LocalMessage; color: string; readColor: string }> = ({
  m,
  color,
  readColor,
}) => {
  if (m.sync_state === 'failed') return <Icon name="alert-circle-outline" size={13} color={color} />;
  if (m.sync_state === 'pending') return <Icon name="clock-outline" size={12} color={color} />;
  if (m.read) return <Icon name="check-all" size={14} color={readColor} />;
  if (m.delivered) return <Icon name="check-all" size={14} color={color} />;
  return <Icon name="check" size={13} color={color} />;
};

export const MessageBubble: React.FC<Props> = ({ message, mine, grouped, onLongPress, onRetry }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { fontScale } = useChatPrefs();
  const c = theme.colors;

  if (message.deleted_at) {
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, styles.deleted, { borderColor: c.border }]}>
          <Icon name="cancel" size={13} color={c.textFaint} />
          <Text style={{ color: c.textFaint, fontStyle: 'italic', marginLeft: 4 }}>—</Text>
        </View>
      </View>
    );
  }

  const bg = mine ? c.bubbleOut : c.bubbleIn;
  const fg = mine ? c.bubbleOutText : c.bubbleInText;
  const failed = message.sync_state === 'failed';

  const bubbleRadius = {
    borderTopLeftRadius: mine ? 18 : grouped ? 6 : 18,
    borderTopRightRadius: mine ? (grouped ? 6 : 18) : 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  };

  return (
    <Pressable
      onLongPress={onLongPress}
      onPress={failed ? onRetry : undefined}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, { marginTop: grouped ? 2 : 6 }]}
    >
      <View style={[styles.bubble, bubbleRadius, { backgroundColor: bg }]}>
        {message.reply_to ? (
          <View style={[styles.reply, { borderLeftColor: mine ? '#ffffffaa' : c.primary }]}>
            <Text style={{ color: fg, opacity: 0.85, fontSize: 13 }} numberOfLines={1}>
              {message.reply_to.body || `[${message.reply_to.type}]`}
            </Text>
          </View>
        ) : null}

        {message.decryptFailed && !message.body ? (
          <View style={styles.encryptedRow}>
            <Icon name="lock-alert-outline" size={14} color={fg} />
            <Text
              style={[
                styles.body,
                { color: fg, fontStyle: 'italic', opacity: 0.85, fontSize: 15 * fontScale },
              ]}
            >
              {t('conversations.encryptedMessage')}
            </Text>
          </View>
        ) : (
          <Text style={[styles.body, { color: fg, fontSize: 15 * fontScale }]}>
            {message.body}
          </Text>
        )}

        <View style={styles.meta}>
          {message.edited_at ? (
            <Text style={[styles.metaText, { color: fg, opacity: 0.6 }]}>
              {t('common.edit').toLowerCase()} ·{' '}
            </Text>
          ) : null}
          <Text style={[styles.metaText, { color: fg, opacity: 0.75 }]}>
            {clockTime(message.created_at)}
          </Text>
          {mine ? (
            <View style={{ marginLeft: 4 }}>
              <StatusTick
                m={message}
                color={failed ? c.danger : fg}
                readColor={mine ? '#7FD0FF' : c.primary}
              />
            </View>
          ) : null}
        </View>

        {message.reaction ? (
          <View style={[styles.reaction, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={{ fontSize: 13 }}>{message.reaction}</Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <Text style={[styles.failedHint, { color: c.danger }]}>{t('sync.failed')}</Text>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, flexDirection: 'column' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8 },
  deleted: { borderWidth: 1, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', borderRadius: 18 },
  reply: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 4, opacity: 0.9 },
  encryptedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  body: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', marginTop: 2, alignItems: 'center' },
  metaText: { fontSize: 11 },
  reaction: {
    position: 'absolute',
    bottom: -11,
    right: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  failedHint: { fontSize: 11, marginTop: 3, marginRight: 4 },
});
