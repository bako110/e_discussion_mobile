import 'react-native-reanimated';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import {
  ActionSheetHost,
  AppAlertHost,
  AppErrorBoundary,
  ThemedStatusBar,
  ToastHost,
} from '@/components/common';
import { AuthProvider } from '@/context/AuthContext';
import { CallPrefsProvider } from '@/context/CallPrefsContext';
import { ChatPrefsProvider } from '@/context/ChatPrefsContext';
import { SyncProvider } from '@/context/SyncContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { RootNavigator } from '@/navigation/RootNavigator';

const App: React.FC = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStatusBar />
        {/* Couvre TOUS les providers (pas seulement RootNavigator) : une
            exception levée pendant leur (re)montage — ex. reprise depuis
            l'arrière-plan après que l'OS a tué le process — doit afficher
            l'écran de secours plutôt que faire planter l'app entière
            (« a cessé de fonctionner » sans red-box en build release). */}
        <AppErrorBoundary>
          <AuthProvider>
            <SyncProvider>
              <ChatPrefsProvider>
                <CallPrefsProvider>
                  <RootNavigator />
                </CallPrefsProvider>
              </ChatPrefsProvider>
            </SyncProvider>
          </AuthProvider>
          {/* Alertes & feuilles d'actions maison — au-dessus de toute la navigation */}
          <ActionSheetHost />
          <AppAlertHost />
          <ToastHost />
        </AppErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
