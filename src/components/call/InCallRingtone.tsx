/**
 * Sons d'appel JOUÉS PAR L'APP elle-même (pas seulement via le son du canal
 * de notification Android) — utilise la vraie sonnerie système pour un
 * appel entrant, et une tonalité embarquée pour le retour d'appel sortant
 * (voir `services/ringtone.ts`).
 *
 * Constat : `notifee.displayNotification({ fullScreenAction })` lance bien
 * l'écran plein écran (`IncomingCallScreen`), mais le SON du canal ne joue
 * pas de façon fiable sur de nombreux appareils dès que `fullScreenAction`
 * prend le relais — l'OS considère l'alerte visuelle plein écran suffisante
 * et coupe/retarde le son. Résultat observé : l'écran d'appel s'affiche
 * correctement, mais l'appareil ne sonne jamais. Même constat côté
 * APPELANT : rien n'entendait « ça sonne chez l'autre » pendant la phase
 * `outgoing`.
 *
 * Fix façon appel téléphonique natif : l'app déclenche elle-même le bon son
 * selon la phase, indépendamment du système de notification. Composant
 * purement logique (aucun rendu) — monté une fois par le RootNavigator,
 * au-dessus de la navigation.
 */
import { useEffect } from 'react';

import { useCall } from '@/context/CallContext';
import { useCallPrefs } from '@/context/CallPrefsContext';
import { startRingback, startRingtone, stopRingback, stopRingtone } from '@/services/ringtone';

export const InCallRingtone: React.FC = () => {
  const { phase, calleeOnline } = useCall();
  const { ringtone, vibrate } = useCallPrefs();

  useEffect(() => {
    if (phase === 'incoming') {
      void startRingtone(ringtone, vibrate);
      void stopRingback();
    } else if (phase === 'outgoing') {
      void stopRingtone();
      // bascule sur la tonalité « injoignable » si le destinataire n'est
      // pas en ligne — sinon la tonalité normale « ça sonne ».
      void startRingback(!calleeOnline);
    } else {
      void stopRingtone();
      void stopRingback();
    }
    return () => {
      void stopRingtone();
      void stopRingback();
    };
  }, [phase, calleeOnline, ringtone, vibrate]);

  return null;
};
