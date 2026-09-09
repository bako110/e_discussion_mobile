/**
 * Référence globale au conteneur de navigation — permet de naviguer et de
 * lire la route active depuis l'extérieur de l'arbre React (services de
 * notification, handlers d'events).
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { MainStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

/** conversationId de l'écran Chat actif, ou null. */
export function activeConversationId(): string | null {
  if (!navigationRef.isReady()) return null;
  const route = navigationRef.getCurrentRoute();
  if (route?.name === 'Chat') {
    const params = route.params as { conversationId?: string } | undefined;
    return params?.conversationId ?? null;
  }
  return null;
}

export function navigateToChat(conversationId: string): void {
  if (!navigationRef.isReady() || !conversationId) return;
  navigationRef.navigate('Chat', {
    conversationId,
    partnerId: '',
    partnerName: '',
  });
}
