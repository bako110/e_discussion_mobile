import { apiClient, Endpoints } from '@/api';
import type { Appointment, AppointmentFilter, AppointmentNote, AppointmentNoteVisibility } from '@/types';

export interface CreateAppointmentInput {
  title: string;
  description?: string;
  location?: string;
  location_map_url?: string;
  /** ISO 8601 (date + heure choisies via les pickers natifs). */
  scheduled_at: string;
  /** ISO 8601, optionnel — doit être après scheduled_at. */
  ends_at?: string;
  participant_user_ids: string[];
}

/**
 * Rendez-vous (RDV) — CRUD direct serveur (pas offline-first comme les
 * messages) : planifier/répondre à un RDV implique des notifications
 * immédiates aux autres participants, ça n'a pas de sens en file d'attente
 * hors-ligne comme un message texte.
 */
export const appointmentService = {
  list(filter?: AppointmentFilter): Promise<Appointment[]> {
    return apiClient.get<Appointment[]>(Endpoints.appointments.list(filter));
  },

  get(id: string): Promise<Appointment> {
    return apiClient.get<Appointment>(Endpoints.appointments.byId(id));
  },

  create(input: CreateAppointmentInput): Promise<Appointment> {
    return apiClient.post<Appointment>(Endpoints.appointments.create, input);
  },

  accept(id: string): Promise<Appointment> {
    return apiClient.post<Appointment>(Endpoints.appointments.accept(id));
  },

  decline(id: string): Promise<Appointment> {
    return apiClient.post<Appointment>(Endpoints.appointments.decline(id));
  },

  cancel(id: string): Promise<Appointment> {
    return apiClient.post<Appointment>(Endpoints.appointments.cancel(id));
  },

  remove(id: string): Promise<void> {
    return apiClient.delete(Endpoints.appointments.byId(id));
  },

  /** Retire ce RDV de MA liste uniquement — n'affecte ni l'organisateur ni
   * les autres participants, aucun changement de statut. */
  hide(id: string): Promise<void> {
    return apiClient.post(Endpoints.appointments.hide(id));
  },

  listNotes(id: string): Promise<AppointmentNote[]> {
    return apiClient.get<AppointmentNote[]>(Endpoints.appointments.notes(id));
  },

  createNote(id: string, body: string, visibility: AppointmentNoteVisibility): Promise<AppointmentNote> {
    return apiClient.post<AppointmentNote>(Endpoints.appointments.notes(id), { body, visibility });
  },

  deleteNote(id: string, noteId: string): Promise<void> {
    return apiClient.delete(Endpoints.appointments.note(id, noteId));
  },
};
