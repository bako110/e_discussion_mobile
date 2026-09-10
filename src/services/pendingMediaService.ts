/**
 * Envoi de médias OFFLINE-FIRST.
 *
 * Contrairement à `messageService.send` (texte), un média est d'abord affiché
 * localement avec son URI de fichier local, puis l'upload + l'envoi sont
 * différés dans l'outbox (`upload_message`). Le `syncEngine` les rejoue dès
 * que le réseau revient — exactement comme WhatsApp : on peut « envoyer »
 * une photo dans l'avion, elle part à l'atterrissage.
 *
 * La ligne locale porte `sync_state='pending'` (horloge ⏱) jusqu'à
 * confirmation serveur ; `failed` si l'upload/envoi échoue définitivement
 * (l'utilisateur peut alors toucher le message pour réessayer).
 */
import { messageRepo } from '@/db/repositories/messageRepo';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';
import { newClientId, outbox } from '@/sync/outbox';
import type { MessageType } from '@/types';

const PREVIEW: Record<string, string> = {
  image: 'Photo',
  video: 'Vidéo',
  voice: 'Message vocal',
  file: 'Document',
};

function kindToType(kind: LocalMediaFile['kind']): MessageType {
  return kind; // 'image' | 'video' | 'voice' | 'file' correspondent 1:1
}

interface SendMediaParams {
  conversationId: string;
  partnerId: string;
  senderId: string;
  local: LocalMediaFile;
  /** Légende éventuelle. */
  body?: string;
}

export const pendingMediaService = {
  /**
   * Crée le message local immédiatement (URI de fichier local en pièce jointe)
   * et empile l'upload différé. Ne touche PAS le réseau.
   */
  async sendMedia(p: SendMediaParams): Promise<void> {
    const type = kindToType(p.local.kind);
    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    const body = (p.body ?? '').trim();

    // meta affichable tout de suite + infos pour l'upload différé
    const meta: Record<string, unknown> = {
      width: p.local.width ?? undefined,
      height: p.local.height ?? undefined,
      duration_sec: p.local.durationSec ?? undefined,
      size: p.local.size ?? undefined,
      name: p.local.file.name,
      mime: p.local.file.type,
      // aperçu local : `mediaUrl()` sait rendre file://… tel quel
      thumbnail_url: type === 'image' || type === 'video' ? p.local.file.uri : undefined,
    };

    // 1) message optimiste — visible immédiatement avec l'horloge
    await messageRepo.insertOutgoing({
      clientId,
      conversationId: p.conversationId,
      senderId: p.senderId,
      type,
      body,
      encrypted: false,
      attachmentUrl: p.local.file.uri, // URI LOCALE (file://…)
      attachmentMeta: meta,
      createdAt,
    });

    // 2) aperçu de la conversation
    try {
      await conversationRepo.touchLastMessage(
        p.conversationId,
        body || PREVIEW[type] || '',
        type,
        false,
        createdAt,
      );
    } catch {
      /* conv locale pas encore créée — sans gravité */
    }

    // 3) upload + envoi différés (rejoués par le syncEngine)
    await outbox.enqueue('upload_message', clientId, {
      conversationId: p.conversationId,
      partnerId: p.partnerId,
      type,
      body,
      localFile: p.local.file, // { uri, name, type }
      attachmentMeta: meta,
      // attachmentUrl absent tant que l'upload n'a pas réussi
    });
  },
};
