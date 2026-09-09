import 'react-native-reanimated';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { AppAlertHost, ThemedStatusBar } from '@/components/common';
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
        <AuthProvider>
          <SyncProvider>
            <ChatPrefsProvider>
              <CallPrefsProvider>
                <RootNavigator />
              </CallPrefsProvider>
            </ChatPrefsProvider>
          </SyncProvider>
        </AuthProvider>
        {/* Alertes maison — au-dessus de toute la navigation */}
        <AppAlertHost />
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
