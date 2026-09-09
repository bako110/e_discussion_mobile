import { apiClient, Endpoints, type UploadFile } from '@/api';

export interface UploadedMedia {
  url: string;
  media_type: 'image' | 'video' | 'audio';
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  size: number;
}

/**
 * Upload d'un fichier local (issu d'un picker / enregistreur) vers le backend.
 * Le serveur redimensionne les images, génère les miniatures (image + vidéo si
 * ffmpeg dispo) et renvoie les URLs publiques.
 */
export const mediaService = {
  upload(file: UploadFile): Promise<UploadedMedia> {
    return apiClient.upload<UploadedMedia>(Endpoints.media.upload, file);
  },
};
