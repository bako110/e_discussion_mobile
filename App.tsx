import 'react-native-reanimated';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { ThemedStatusBar } from '@/components/common';
import { AuthProvider } from '@/context/AuthContext';
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
              <RootNavigator />
            </ChatPrefsProvider>
          </SyncProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
