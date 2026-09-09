/**
 * Modal explicatif du chiffrement de bout en bout — façon WhatsApp.
 * S'ouvre depuis le bandeau « Messages chiffrés » du chat ou le menu ⋮.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  visible: boolean;
  partnerName?: string;
  onClose: () => void;
}

export const EncryptionInfoModal: React.FC<Props> = ({ visible, partnerName, onClose }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const points: { icon: string; title: string; body: string }[] = [
    {
      icon: 'lock-check',
      title: t('encryption.p1Title'),
      body: t('encryption.p1Body'),
    },
    {
      icon: 'key-variant',
      title: t('encryption.p2Title'),
      body: t('encryption.p2Body'),
    },
    {
      icon: 'server-off',
      title: t('encryption.p3Title'),
      body: t('encryption.p3Body'),
    },
    {
      icon: 'cellphone-key',
      title: t('encryption.p4Title'),
      body: t('encryption.p4Body'),
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              paddingBottom: insets.bottom + 16,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.grabber} />
          <View style={[styles.hero, { backgroundColor: c.primary + '14' }]}>
            <Icon name="shield-lock" size={34} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>{t('encryption.title')}</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            {partnerName
              ? t('encryption.subtitleWith', { name: partnerName })
              : t('encryption.subtitle')}
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {points.map((p) => (
              <View key={p.icon} style={styles.point}>
                <View style={[styles.pointIcon, { backgroundColor: c.surfaceAlt }]}>
                  <Icon name={p.icon} size={19} color={c.primary} />
                </View>
                <View style={styles.pointTxt}>
                  <Text style={[styles.pointTitle, { color: c.text }]}>{p.title}</Text>
                  <Text style={[styles.pointBody, { color: c.textMuted }]}>{p.body}</Text>
                </View>
              </View>
            ))}

            <Text style={[styles.footnote, { color: c.textFaint }]}>
              {t('encryption.footnote')}
            </Text>
          </ScrollView>

          <Pressable
            style={[styles.btn, { backgroundColor: c.primary }]}
            onPress={onClose}
            android_ripple={{ color: '#ffffff30' }}
          >
            <Text style={styles.btnText}>{t('common.ok')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.55)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 14,
  },
  hero: {
    alignSelf: 'center',
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { fontSize: 13.5, textAlign: 'center', marginTop: 6, lineHeight: 19, paddingHorizontal: 8 },
  list: { marginTop: 16 },
  listContent: { paddingBottom: 8 },
  point: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  pointIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointTxt: { flex: 1, gap: 2 },
  pointTitle: { fontSize: 14.5, fontWeight: '700' },
  pointBody: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  btn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
