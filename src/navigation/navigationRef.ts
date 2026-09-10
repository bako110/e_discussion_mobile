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

/**
 * Identifiant du fil de discussion ACTIF (1-to-1 ou groupe) — sert au
 * mini-lecteur vocal global pour se masquer dans le chat d'origine.
 * Renvoie le `conversationId` sur l'écran Chat, le `groupId` sur GroupChat.
 */
export function activeThreadId(): string | null {
  if (!navigationRef.isReady()) return null;
  const route = navigationRef.getCurrentRoute();
  if (route?.name === 'Chat') {
    return (route.params as { conversationId?: string } | undefined)?.conversationId ?? null;
  }
  if (route?.name === 'GroupChat') {
    return (route.params as { groupId?: string } | undefined)?.groupId ?? null;
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
