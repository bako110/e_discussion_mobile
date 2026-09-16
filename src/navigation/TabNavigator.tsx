import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs } from '@/context/WebSocketContext';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import { onUnreadChanged } from '@/services/notificationService';
import { CallsScreen } from '@/screens/Main/CallsScreen';
import { ConversationsScreen } from '@/screens/Main/ConversationsScreen';
import { GroupsTabScreen } from '@/screens/Main/GroupsListScreen';
import { SettingsScreen } from '@/screens/Main/SettingsScreen';
import { StatusScreen } from '@/screens/Main/StatusScreen';

import { SwipeableTab } from './SwipeableTab';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Hauteur de la rangee d'onglets. La barre s'etend en plus SOUS cette hauteur
// jusqu'au bord de l'ecran (safe-area bottom) — comme le header couvre la
// status bar en haut.
export const BAR_HEIGHT = 62;

interface TabItemProps {
  icon: string;
  iconFocused?: string;
  label: string;
  focused: boolean;
  badge?: number;
}

const TabItem: React.FC<TabItemProps> = ({ icon, iconFocused, label, focused, badge }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const color = focused ? c.primary : c.textMuted;
  return (
    <View style={styles.item}>
      {focused ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : <View style={styles.dot} />}
      <View style={styles.iconWrap}>
        <Icon name={focused ? iconFocused ?? icon : icon} size={23} color={color} />
        {badge && badge > 0 ? (
          <View style={[styles.badge, { backgroundColor: c.primary, borderColor: c.card }]}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

// Écrans enveloppés : balayage horizontal gauche/droite -> onglet suivant /
// précédent (façon WhatsApp), en plus du tap sur la barre.
const ChatsTabScene = () => (
  <SwipeableTab name="ChatsTab">
    <ConversationsScreen />
  </SwipeableTab>
);
const CallsTabScene = () => (
  <SwipeableTab name="CallsTab">
    <CallsScreen />
  </SwipeableTab>
);
const StatusTabScene = () => (
  <SwipeableTab name="StatusTab">
    <StatusScreen />
  </SwipeableTab>
);
const GroupsTabScene = () => (
  <SwipeableTab name="GroupsTab">
    <GroupsTabScreen />
  </SwipeableTab>
);
const SettingsTabScene = () => (
  <SwipeableTab name="SettingsTab">
    <SettingsScreen />
  </SwipeableTab>
);

/**
 * Total des messages 1-1 non lus, pour le badge de l'onglet Discussions —
 * toujours à jour même quand l'écran d'appel est ouvert par-dessus (ce
 * composant est monté en permanence, indépendamment de l'écran actif).
 * Se recalcule au montage puis à chaque `message.new`/`conversation.*` reçu
 * par le WebSocket (même pattern que `useGroups`/`useStories`).
 */
function useChatsUnread(): number {
  const { addListener } = useWs();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const reload = () => {
      void conversationRepo.list().then((rows) => {
        if (!alive) return;
        setUnread(rows.reduce((n, r) => n + (r.unread_count || 0), 0));
      });
    };
    reload();
    const unsub = addListener((e) => {
      const type = String(e.type);
      if (type === 'message.new' || type.startsWith('conversation.')) reload();
    });
    // `markRead()` (ouvrir une conversation) est une mutation 100% LOCALE —
    // aucun event WebSocket associé — donc sans cet abonnement le badge
    // restait affiché tel quel après avoir lu les messages tant qu'aucun
    // nouvel event WS n'arrivait entre-temps.
    const unsubUnread = onUnreadChanged(reload);
    return () => {
      alive = false;
      unsub();
      unsubUnread();
    };
  }, [addListener]);

  return unread;
}

export const TabNavigator: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { unseenCount } = useStories();
  const { groups, channels } = useGroups();
  const chatsUnread = useChatsUnread();
  const c = theme.colors;

  const groupsUnread =
    [...groups, ...channels].reduce((n, g) => n + (g.unread_count || 0), 0) || 0;

  // La barre couvre la zone des boutons de navigation Android (safe-area bas).
  const safeBottom = insets.bottom;
  const totalHeight = BAR_HEIGHT + safeBottom;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          // Barre PLEINE LARGEUR collee en bas — symetrique du header en haut.
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: totalHeight,
          paddingBottom: safeBottom,
          paddingHorizontal: 4,
          backgroundColor: c.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.divider,
          elevation: 12,
          shadowColor: '#0A1730',
          shadowOpacity: 0.14,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarItemStyle: { height: BAR_HEIGHT },
        // Reserve la place de la barre sous le contenu de chaque onglet.
        sceneStyle: { paddingBottom: totalHeight },
      }}
    >
      <Tab.Screen
        name="ChatsTab"
        component={ChatsTabScene}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="message-text-outline"
              iconFocused="message-text"
              label={t('tabs.chats')}
              focused={focused}
              badge={chatsUnread}
            />
          ),
        }}
      />
      <Tab.Screen
        name="CallsTab"
        component={CallsTabScene}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="phone-outline"
              iconFocused="phone"
              label={t('tabs.calls')}
              focused={focused}
            />
          ),
        }}
      />
      <Tab.Screen
        name="StatusTab"
        component={StatusTabScene}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="circle-slice-8"
              iconFocused="circle-slice-8"
              label={t('tabs.status')}
              focused={focused}
              badge={unseenCount}
            />
          ),
        }}
      />
      <Tab.Screen
        name="GroupsTab"
        component={GroupsTabScene}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="account-group-outline"
              iconFocused="account-group"
              label={t('tabs.groups')}
              focused={focused}
              badge={groupsUnread}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsTabScene}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="cog-outline"
              iconFocused="cog"
              label={t('tabs.settings')}
              focused={focused}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  item: { alignItems: 'center', justifyContent: 'center', width: 62, gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, marginBottom: 1 },
  iconWrap: { width: 26, alignItems: 'center' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: -0.3 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
