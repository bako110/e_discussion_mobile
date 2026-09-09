import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OtpScreen } from '@/screens/Auth/OtpScreen';
import { PhoneScreen } from '@/screens/Auth/PhoneScreen';
import { WelcomeScreen } from '@/screens/Auth/WelcomeScreen';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export const AuthNavigator: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
    <Stack.Screen name="Welcome" component={WelcomeScreen} />
    <Stack.Screen name="Phone" component={PhoneScreen} />
    <Stack.Screen name="Otp" component={OtpScreen} />
  </Stack.Navigator>
);
