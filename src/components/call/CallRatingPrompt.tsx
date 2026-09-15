/**
 * Invite de notation post-appel — qualité de l'appel (obligatoire) + note de
 * l'application (facultative), façon bottom-sheet. Proposée occasionnellement
 * après un appel réellement connecté (voir `callRatingPrompt.ts` pour le
 * cooldown) : le cooldown est marqué dès l'affichage, réponse ou non.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon, showToast } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { callService } from '@/services/callService';
import { markCallRatingPromptShown } from '@/services/callRatingPrompt';

interface Props {
  visible: boolean;
  callId: string;
  peerName: string | null;
  onDone: () => void;
}

const StarRow: React.FC<{
  value: number;
  onChange: (v: number) => void;
  color: string;
  faint: string;
}> = ({ value, onChange, color, faint }) => (
  <View style={styles.stars}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Pressable key={n} onPress={() => onChange(n)} hitSlop={6}>
        <Icon
          name={n <= value ? 'star' : 'star-outline'}
          size={32}
          color={n <= value ? color : faint}
        />
      </Pressable>
    ))}
  </View>
);

export const CallRatingPrompt: React.FC<Props> = ({ visible, callId, peerName, onDone }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;

  const [callScore, setCallScore] = useState(0);
  const [appScore, setAppScore] = useState(0);
  const [sending, setSending] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setCallScore(0);
      setAppScore(0);
      // marqué dès l'affichage : réponse ou fermeture sans répondre déclenchent
      // toutes les deux le cooldown, comme demandé.
      if (!shownRef.current) {
        shownRef.current = true;
        markCallRatingPromptShown();
      }
    } else {
      shownRef.current = false;
    }
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const close = () => onDone();

  const submit = async () => {
    if (!callScore || sending) return;
    setSending(true);
    try {
      await callService.rate(callId, callScore, appScore || null);
      showToast(t('callRating.thanks'));
    } catch {
      /* best-effort : ne bloque pas l'utilisateur pour un simple avis */
    } finally {
      setSending(false);
      onDone();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
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

          <Text style={[styles.title, { color: c.text }]}>
            {peerName ? t('callRating.titleWith', { name: peerName }) : t('callRating.title')}
          </Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>{t('callRating.callLabel')}</Text>
          <StarRow value={callScore} onChange={setCallScore} color={c.primary} faint={c.textFaint} />

          <Text style={[styles.subtitle, { color: c.textMuted, marginTop: 18 }]}>
            {t('callRating.appLabel')}
          </Text>
          <StarRow value={appScore} onChange={setAppScore} color={c.primary} faint={c.textFaint} />

          <Pressable
            style={[
              styles.btn,
              { backgroundColor: c.primary, opacity: callScore ? 1 : 0.5 },
            ]}
            onPress={() => void submit()}
            disabled={!callScore || sending}
            android_ripple={{ color: '#ffffff30' }}
          >
            <Text style={styles.btnText}>
              {sending ? t('common.loading') : t('callRating.submit')}
            </Text>
          </Pressable>
          <Pressable style={styles.skip} onPress={close}>
            <Text style={[styles.skipText, { color: c.textMuted }]}>{t('callRating.skip')}</Text>
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
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 18,
  },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, textAlign: 'center', marginTop: 14, marginBottom: 10 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  btn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 13.5, fontWeight: '600' },
});
