/**
 * Décide d'afficher ou non l'invite de notation post-appel quand un appel
 * connecté vient de se terminer (voir `CallContext.justEndedCall` et
 * `callRatingPrompt.ts` pour le cooldown). Monté globalement à côté de
 * `CallOverlay` — indépendant de `phase` pour s'afficher une fois l'overlay
 * d'appel redevenu 'idle'.
 */
import React, { useEffect, useState } from 'react';

import { useCall } from '@/context/CallContext';
import { canShowCallRatingPrompt } from '@/services/callRatingPrompt';

import { CallRatingPrompt } from './CallRatingPrompt';

export const CallRatingGate: React.FC = () => {
  const { phase, justEndedCall, clearJustEndedCall } = useCall();
  const [prompt, setPrompt] = useState<{ callId: string; peerName: string | null } | null>(null);

  useEffect(() => {
    // attend le retour à 'idle' (fin de l'affichage "Appel terminé") avant de
    // proposer la notation, pour ne pas superposer les deux UI.
    if (phase !== 'idle' || !justEndedCall) return;
    const c = justEndedCall;
    clearJustEndedCall();
    if (!canShowCallRatingPrompt()) return;
    setPrompt({
      callId: c.callId,
      peerName: c.peer?.display_name || c.peer?.username || null,
    });
  }, [phase, justEndedCall, clearJustEndedCall]);

  if (!prompt) return null;

  return (
    <CallRatingPrompt
      visible
      callId={prompt.callId}
      peerName={prompt.peerName}
      onDone={() => setPrompt(null)}
    />
  );
};
