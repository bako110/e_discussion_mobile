/**
 * Bottom sheet du sélecteur « N canaux » — liste la chaîne + ses canaux de
 * discussion liés DONT L'UTILISATEUR EST MEMBRE (voir GroupChatScreen,
 * groupService.listMyLinkedChannels). Un tap navigue vers le groupe choisi.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Avatar, Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { DiscussionChannel } from '@/types';

interface Props {
  visible: boolean;
  channels: DiscussionChannel[];
  currentGroupId: string;
  onClose: () => void;
  onSelect: (groupId: string, name: string) => void;
}

export const LinkedChannelsSheet: React.FC<Props> = ({
  visible,
  channels,
  currentGroupId,
  onClose,
  onSelect,
}) => {
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
          <Text style={[styles.title, { color: c.text }]}>
            {t('groupSettings.linkedChannelsSheetTitle')}
          </Text>

          {channels.map((ch) => {
            const active = ch.id === currentGroupId;
            return (
              <Pressable
                key={ch.id}
                style={[styles.row, active && { backgroundColor: c.surfaceAlt }]}
                android_ripple={{ color: c.surfaceAlt }}
                onPress={() => onSelect(ch.id, ch.name)}
              >
                <View>
                  <Avatar uri={ch.avatar_url} name={ch.name} size={44} />
                  {ch.kind === 'channel' ? (
                    <View style={[styles.kindDot, { backgroundColor: c.primary, borderColor: c.card }]}>
                      <Icon
                        name={active ? 'bullhorn' : 'message-reply-text-outline'}
                        size={10}
                        color="#fff"
                      />
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                  {ch.name}
                </Text>
                {active ? <Icon name="check-circle" size={20} color={c.primary} /> : null}
              </Pressable>
            );
          })}
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
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 14,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
  },
  kindDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600' },
});
