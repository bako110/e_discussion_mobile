import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ProfileSetupScreen } from '@/screens/Auth/ProfileSetupScreen';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export const OnboardingNavigator: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
  </Stack.Navigator>
);
