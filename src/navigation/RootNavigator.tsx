import React, { useEffect } from 'react';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import notifee, { EventType } from '@notifee/react-native';

import { SplashView } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { CallProvider } from '@/context/CallContext';
import { GroupsProvider } from '@/context/GroupsContext';
import { MessageNotifications } from '@/context/MessageNotifications';
import { MessageSync } from '@/context/MessageSync';
import { StoriesProvider } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import { WebSocketProvider } from '@/context/WebSocketContext';
import { navigateToChat, navigationRef } from '@/navigation/navigationRef';
import { registerPushToken } from '@/services/pushTokenService';
import { subscribeFcmForeground } from '@/services/fcm';
import { CallOverlay } from '@/screens/Main/CallOverlay';

import { AuthNavigator } from './AuthNavigator';
import { linking } from './linking';
import { MainNavigator } from './MainNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';

export const RootNavigator: React.FC = () => {
  const { status } = useAuth();
  const { theme, isDark } = useTheme();

  // enregistre le jeton de push natif dès qu'on est authentifié
  useEffect(() => {
    if (status !== 'authenticated') return;
    void registerPushToken();
    // course réseau : un push peut arriver alors que l'app est active
    const off = subscribeFcmForeground();
    return off;
  }, [status]);

  // ouverture d'une conversation / de l'historique quand on tape une notif
  useEffect(() => {
    const openFromData = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (data.kind === 'message' && typeof data.conversationId === 'string') {
        navigateToChat(data.conversationId);
      } else if (data.kind === 'missed-call') {
        if (navigationRef.isReady()) navigationRef.navigate('NotificationHistory');
      }
    };
    void notifee.getInitialNotification().then((initial) => {
      openFromData(initial?.notification?.data);
    });
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) openFromData(detail.notification?.data);
    });
    return unsub;
  }, []);

  const navTheme: Theme = {
    dark: isDark,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.card,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.primary,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '800' },
    },
  };

  if (status === 'loading') return <SplashView />;

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={status === 'authenticated' ? linking : undefined}
      fallback={<SplashView />}
    >
      {status === 'authenticated' ? (
        <WebSocketProvider enabled>
          <CallProvider>
            <StoriesProvider>
              <GroupsProvider>
                <MainNavigator />
              </GroupsProvider>
            </StoriesProvider>
            <MessageSync />
            <MessageNotifications />
            <CallOverlay />
          </CallProvider>
        </WebSocketProvider>
      ) : status === 'onboarding' ? (
        <OnboardingNavigator />
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
};
