/**
 * Écran d'appel entrant — affiché en plein écran par le RootNavigator dès
 * qu'un event WS `call.incoming` arrive (phase 'incoming').
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Avatar, Icon } from '@/components/common';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';

export const IncomingCallScreen: React.FC = () => {
  const { call, acceptCall, rejectCall, phase } = useCall();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  if (!call) return null;
  const name = call.peer?.display_name || call.peer?.username || t('calls.unknown');
  const isVideo = call.callType === 'video';
  const connecting = phase === 'connecting';

  return (
    <View style={[styles.root, { backgroundColor: '#0B1220', paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
      <View style={styles.top}>
        <Text style={styles.kind}>
          {isVideo ? t('calls.incomingVideo') : t('calls.incomingVoice')}
        </Text>
        <View style={styles.avatarWrap}>
          <Avatar uri={call.peer?.avatar_url} name={name} size={132} />
        </View>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.e2ee}>
          <Icon name="lock" size={12} color="#8FA6C8" /> {t('calls.e2eeNotice')}
        </Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionCol}>
          <Pressable
            style={[styles.btn, { backgroundColor: c.danger }]}
            onPress={() => void rejectCall()}
            android_ripple={{ color: '#ffffff40', borderless: true }}
          >
            <Icon name="phone-hangup" size={30} color="#fff" />
          </Pressable>
          <Text style={styles.actionLabel}>{t('calls.decline')}</Text>
        </View>

        <View style={styles.actionCol}>
          <Pressable
            style={[styles.btn, { backgroundColor: c.success, opacity: connecting ? 0.5 : 1 }]}
            disabled={connecting}
            onPress={() => void acceptCall()}
            android_ripple={{ color: '#ffffff40', borderless: true }}
          >
            <Icon name={isVideo ? 'video' : 'phone'} size={30} color="#fff" />
          </Pressable>
          <Text style={styles.actionLabel}>
            {connecting ? t('calls.connecting') : t('calls.accept')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'space-between' },
  top: { alignItems: 'center', gap: 14 },
  kind: { color: '#8FA6C8', fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  avatarWrap: { marginTop: 8 },
  name: { color: '#fff', fontSize: 28, fontWeight: '800', maxWidth: 320, textAlign: 'center' },
  e2ee: { color: '#8FA6C8', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 72 },
  actionCol: { alignItems: 'center', gap: 10 },
  btn: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: '#cdd8ec', fontSize: 13, fontWeight: '600' },
});
