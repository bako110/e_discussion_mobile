import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useStories } from '@/context/StoriesContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { CallsScreen } from '@/screens/Main/CallsScreen';
import { ConversationsScreen } from '@/screens/Main/ConversationsScreen';
import { SettingsScreen } from '@/screens/Main/SettingsScreen';
import { StatusScreen } from '@/screens/Main/StatusScreen';

import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

// Hauteur de la rangee d'onglets. La barre s'etend en plus SOUS cette hauteur
// jusqu'au bord de l'ecran (safe-area bottom) — comme le header couvre la
// status bar en haut.
const BAR_HEIGHT = 62;

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

export const TabNavigator: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { pending } = useSync();
  const { unseenCount } = useStories();
  const c = theme.colors;

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
        component={ConversationsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="message-text-outline"
              iconFocused="message-text"
              label={t('tabs.chats')}
              focused={focused}
            />
          ),
        }}
      />
      <Tab.Screen
        name="CallsTab"
        component={CallsScreen}
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
        component={StatusScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="record-circle-outline"
              iconFocused="record-circle"
              label={t('tabs.status')}
              focused={focused}
              badge={unseenCount}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem
              icon="cog-outline"
              iconFocused="cog"
              label={t('tabs.settings')}
              focused={focused}
              badge={pending}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  item: { alignItems: 'center', justifyContent: 'center', width: 72, gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, marginBottom: 1 },
  iconWrap: { width: 26, alignItems: 'center' },
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: -0.2 },
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
