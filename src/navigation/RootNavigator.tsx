import React, { useEffect } from 'react';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import notifee, { EventType } from '@notifee/react-native';

import { SplashView } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { AppointmentSync } from '@/context/AppointmentSync';
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
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '@/services/batteryOptimization';
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from '@/services/backgroundKeepAlive';
import { storage } from '@/utils/storage';
import { CallOverlay } from '@/screens/Main/CallOverlay';
import { GlobalVoiceBar } from '@/components/chat/GlobalVoiceBar';
import { InCallRingtone } from '@/components/call/InCallRingtone';
import { CallRatingGate } from '@/components/call/CallRatingGate';

import { AuthNavigator } from './AuthNavigator';
import { linking } from './linking';
import { MainNavigator } from './MainNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';

export const RootNavigator: React.FC = () => {
  const { status, me } = useAuth();
  const { theme, isDark } = useTheme();

  // enregistre le jeton de push natif dès qu'on est authentifié
  useEffect(() => {
    if (status !== 'authenticated') return;
    void registerPushToken();
    // course réseau : un push peut arriver alors que l'app est active
    const off = subscribeFcmForeground();
    return off;
  }, [status]);

  // Demande l'exemption d'optimisation batterie UNE SEULE FOIS après le
  // premier login — sans elle, certains OEM (Transsion/Infinix/Tecno) coupent
  // silencieusement les push en arrière-plan, façon WhatsApp/Telegram/Signal
  // qui font la même demande. Refusable, et re-proposable depuis les réglages
  // de notification si l'utilisateur change d'avis plus tard.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const K_ASKED = 'battery_opt_asked';
    if (storage.getBoolean(K_ASKED)) return;
    const t = setTimeout(() => {
      void isIgnoringBatteryOptimizations().then((ok) => {
        if (!ok) void requestIgnoreBatteryOptimizations();
        storage.set(K_ASKED, true);
      });
    }, 2500); // laisse l'app se stabiliser avant une boîte de dialogue système
    return () => clearTimeout(t);
  }, [status]);

  // Foreground service de maintien en arrière-plan (façon WhatsApp) : démarré
  // UNE SEULE FOIS dès l'authentification (app forcément au premier plan à
  // ce moment), puis reste actif en continu jusqu'à la déconnexion.
  //
  // IMPORTANT — pourquoi pas de start/stop sur les transitions AppState :
  // Android restreint fortement `startForegroundService()` quand il est
  // appelé alors que l'app est DÉJÀ en arrière-plan (le cas classique d'un
  // listener sur le passage en background) — le service peut alors ne
  // jamais atteindre `onStartCommand`, ce qui fait planter TOUT LE PROCESS
  // avec `ForegroundServiceDidNotStartInTimeException` au bout du délai
  // imparti (observé en prod, reproductible à chaque appel entrant en
  // arrière-plan). Démarrer une seule fois pendant que l'app est au premier
  // plan (juste après le login) évite cette restriction : le service est
  // déjà vivant quand l'app passe ensuite en arrière-plan, plus besoin de
  // le (re)créer à ce moment précis.
  useEffect(() => {
    if (status !== 'authenticated') {
      void stopBackgroundKeepAlive();
      return;
    }
    void startBackgroundKeepAlive();
    return () => {
      void stopBackgroundKeepAlive();
    };
  }, [status]);

  // ouverture d'une conversation / de l'historique quand on tape une notif
  useEffect(() => {
    const openFromData = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      if (data.kind === 'message' && typeof data.conversationId === 'string') {
        navigateToChat(data.conversationId);
      } else if (data.kind === 'missed-call') {
        if (navigationRef.isReady()) navigationRef.navigate('NotificationHistory');
      } else if (data.kind === 'story' && typeof data.authorId === 'string') {
        const authorId = data.authorId;
        if (navigationRef.isReady()) navigationRef.navigate('StoryViewer', { authorId });
      } else if (data.kind === 'appointment' && typeof data.appointmentId === 'string') {
        const appointmentId = data.appointmentId;
        if (navigationRef.isReady()) navigationRef.navigate('AppointmentDetail', { appointmentId });
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
        <WebSocketProvider key={me?.id} enabled>
          <CallProvider>
            <StoriesProvider>
              <GroupsProvider>
                <MainNavigator />
              </GroupsProvider>
            </StoriesProvider>
            <MessageSync />
            <AppointmentSync />
            <MessageNotifications />
            <CallOverlay />
            <GlobalVoiceBar />
            <InCallRingtone />
            <CallRatingGate />
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
