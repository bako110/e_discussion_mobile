/**
 * Ingestion TEMPS RÉEL des événements de rendez-vous (`appointment.new` /
 * `appointment.updated`) — les RDV ne sont pas offline-first (pas de SQLite
 * local), donc contrairement à `MessageSync` on relaie directement le payload
 * complet aux écrans abonnés plutôt que d'écrire en base.
 *
 * Monté une fois sous `WebSocketProvider` (voir RootNavigator).
 */
import { useEffect } from 'react';

import { useWs, type WsEvent } from '@/context/WebSocketContext';
import type { Appointment } from '@/types';

type AppointmentListener = (appointment: Appointment) => void;
const listeners = new Set<AppointmentListener>();

/** Écrans RDV : s'abonner pour être notifié dès qu'un RDV est créé ou mis à
 * jour (accepté/refusé/annulé) par un event WebSocket temps réel. */
export function onAppointmentEvent(fn: AppointmentListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(appointment: Appointment): void {
  listeners.forEach((fn) => {
    try {
      fn(appointment);
    } catch {
      /* un abonné ne casse pas les autres */
    }
  });
}

export const AppointmentSync: React.FC = () => {
  const { addListener } = useWs();

  useEffect(() => {
    return addListener((e: WsEvent) => {
      if (e.type === 'appointment.new' || e.type === 'appointment.updated') {
        const appointment = e.appointment as Appointment | undefined;
        if (appointment) emit(appointment);
      }
    });
  }, [addListener]);

  return null;
};
