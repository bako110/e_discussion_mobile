/**
 * Feuille minimale d'appui long sur un message : juste la rangée d'émojis de
 * réaction. Utilisée pour les messages de groupe/chaîne — contrairement aux
 * messages 1-1 (voir MessageActionSheet), ces messages n'ont pas encore de
 * Répondre/Modifier/Transférer/Supprimer, donc pas besoin de ces callbacks.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';
import { QUICK_REACTIONS } from './MessageActionSheet';

interface Props {
  visible: boolean;
  currentReaction: string | null;
  onReact: (emoji: string | null) => void;
  onClose: () => void;
}

export const QuickReactionSheet: React.FC<Props> = ({
  visible,
  currentReaction,
  onReact,
  onClose,
}) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

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
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.grabber} />
          <View style={styles.emojiRow}>
            {QUICK_REACTIONS.map((e) => {
              const on = currentReaction === e;
              return (
                <Pressable
                  key={e}
                  onPress={() => {
                    onClose();
                    setTimeout(() => onReact(on ? null : e), 110);
                  }}
                  style={[styles.emojiBtn, on && { backgroundColor: c.primary + '22' }]}
                >
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.5)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 8,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  emojiBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
});
