import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
} from '@react-navigation/material-top-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import { CallsScreen } from '@/screens/Main/CallsScreen';
import { ConversationsScreen } from '@/screens/Main/ConversationsScreen';
import { GroupsTabScreen } from '@/screens/Main/GroupsListScreen';
import { SettingsScreen } from '@/screens/Main/SettingsScreen';
import { StatusScreen } from '@/screens/Main/StatusScreen';

import type { TabParamList } from './types';

const Tab = createMaterialTopTabNavigator<TabParamList>();

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

/** Icône + libellé + badge par onglet. Ordre = ordre des <Tab.Screen>. */
type TabMeta = { icon: string; iconFocused?: string; label: string; badge?: number };

/**
 * Barre d'onglets maison rendue EN BAS (`tabBarPosition="bottom"`). Reprend
 * exactement l'apparence de l'ancienne bottom-tab bar, mais le navigateur
 * sous-jacent est un material-top-tabs -> balayage horizontal gauche/droite
 * pour changer d'onglet (façon WhatsApp), en plus du tap.
 */
const BottomTabBar: React.FC<MaterialTopTabBarProps & { metas: TabMeta[] }> = ({
  state,
  navigation,
  metas,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const safeBottom = insets.bottom;

  return (
    <View
      style={[
        styles.bar,
        {
          height: BAR_HEIGHT + safeBottom,
          paddingBottom: safeBottom,
          backgroundColor: c.card,
          borderTopColor: c.divider,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const meta = metas[index]!;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.tabBtn}
            android_ripple={{ color: c.surfaceAlt, borderless: true, radius: 34 }}
          >
            <TabItem
              icon={meta.icon}
              iconFocused={meta.iconFocused}
              label={meta.label}
              focused={focused}
              badge={meta.badge}
            />
          </Pressable>
        );
      })}
    </View>
  );
};

export const TabNavigator: React.FC = () => {
  const { t } = useTranslation();
  const { unseenCount } = useStories();
  const { groups, channels } = useGroups();

  const groupsUnread =
    [...groups, ...channels].reduce((n, g) => n + (g.unread_count || 0), 0) || 0;

  const metas: TabMeta[] = [
    { icon: 'message-text-outline', iconFocused: 'message-text', label: t('tabs.chats') },
    { icon: 'phone-outline', iconFocused: 'phone', label: t('tabs.calls') },
    { icon: 'circle-slice-8', iconFocused: 'circle-slice-8', label: t('tabs.status'), badge: unseenCount },
    { icon: 'account-group-outline', iconFocused: 'account-group', label: t('tabs.groups'), badge: groupsUnread },
    { icon: 'cog-outline', iconFocused: 'cog', label: t('tabs.settings') },
  ];

  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      // le contenu défile sous le doigt ; le tap reste instantané
      screenOptions={{
        swipeEnabled: true,
        animationEnabled: true,
        lazy: true,
      }}
      tabBar={(props) => <BottomTabBar {...props} metas={metas} />}
    >
      <Tab.Screen name="ChatsTab" component={ConversationsScreen} />
      <Tab.Screen name="CallsTab" component={CallsScreen} />
      <Tab.Screen name="StatusTab" component={StatusScreen} />
      <Tab.Screen name="GroupsTab" component={GroupsTabScreen} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 12,
    shadowColor: '#0A1730',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  tabBtn: { flex: 1, height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' },
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
