import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import type { GroupKind, GroupPreview, Story } from '@/types';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';

export type AuthStackParamList = {
  Welcome: undefined;
  Phone: undefined;
  Otp: { e164: string; pretty: string; resendIn: number; devCode?: string | null };
};

export type OnboardingStackParamList = {
  ProfileSetup: undefined;
};

export type TabParamList = {
  ChatsTab: undefined;
  CallsTab: undefined;
  StatusTab: undefined;
  GroupsTab: undefined;
  SettingsTab: undefined;
};

export type MainStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Chat: {
    conversationId: string;
    partnerId: string;
    partnerName: string;
    partnerAvatar?: string | null;
    /** Depuis l'écran de recherche : id du message à faire défiler jusqu'à
     * l'écran et surligner brièvement. `jumpToCreatedAt` (son `created_at`)
     * sert à dimensionner le chargement local nécessaire pour le trouver —
     * voir `messageRepo.countAtOrNewer`. */
    jumpToMessageId?: string;
    jumpToCreatedAt?: string;
  };
  /** Détail / paramètres d'une conversation (contact, médias, sourdine…). */
  ConversationInfo: {
    conversationId: string;
    partnerId: string;
    partnerName: string;
    partnerAvatar?: string | null;
  };
  /** Recherche de messages (texte + plage de dates) dans une conversation
   * 1-to-1 OU un groupe/chaîne — un seul écran réutilisable, `mode` distingue
   * les deux formes de params. */
  ChatSearch:
    | {
        mode: 'dm';
        conversationId: string;
        partnerId: string;
        partnerName: string;
        partnerAvatar?: string | null;
      }
    | { mode: 'group'; groupId: string; groupName: string };
  /** Page dédiée façon WhatsApp : uniquement les FICHIERS (documents)
   * partagés dans la conversation — jamais mélangés aux photos/vidéos, qui
   * restent dans la grille de `ConversationInfo`. */
  SharedFiles: {
    conversationId: string;
  };
  /** Aperçu du profil d'un utilisateur en lecture seule (photo, bio,
   * présence) — ouvert en tapant un avatar hors du chat (recherche, membres
   * de groupe…). `name`/`avatar` sont un repli affiché pendant le chargement.
   * `group` : présent quand on arrive depuis la liste des membres d'un groupe
   * — affiche le rôle et, si `canManage` (moi = admin/owner du groupe), les
   * actions promouvoir / retirer pour CE membre. */
  UserProfile: {
    userId: string;
    name?: string;
    avatar?: string | null;
    group?: { groupId: string; role: string; isChannel: boolean; canManage: boolean };
  };
  /** `mode` : 'chat' (defaut) ouvre la conversation ; 'call' lance un appel. */
  NewConversation: { mode?: 'chat' | 'call' } | undefined;
  EditProfile: undefined;
  AccountSettings: undefined;
  /** Lier un e-mail ou un numéro secondaire au compte. */
  LinkIdentifier: { kind: 'email' | 'phone' };
  /** Appareils liés au compte (E2E) + révocation. */
  Devices: undefined;
  /** Utilisateurs bloqués + déblocage. */
  BlockedUsers: undefined;
  /** Synchro du carnet d'adresses -> contacts qui utilisent l'app. */
  ContactSync: undefined;
  PrivacySettings: undefined;
  ChatsSettings: undefined;
  CallsSettings: undefined;
  NotificationsSettings: undefined;
  /** Historique des notifications reçues (messages + appels). */
  NotificationHistory: undefined;
  AppearanceSettings: undefined;
  StorageSettings: undefined;
  HelpSettings: undefined;
  AboutSettings: undefined;
  /** FAQ / centre d'aide — contenu statique natif. */
  FaqSettings: undefined;
  /** Formulaire « Nous contacter » (motif + message -> e-mail support). */
  ContactUs: undefined;
  /** Conditions d'utilisation — texte statique natif. */
  TermsOfService: undefined;
  /** Politique de confidentialité — texte statique natif. */
  PrivacyPolicy: undefined;
  /** Signaler un profil : motif + détails libres. */
  ReportProfile: { userId: string; name: string };
  StoryComposer: undefined;
  /** Sélection multiple de contacts. `token` relie l'appel à sa réponse. */
  SelectContacts: {
    token: string;
    title?: string;
    preselected?: string[];
    confirmLabel?: string;
  };
  /** Éditeur média (recadrage / dessin / légende / stickers) avant publication. */
  /** Fichier local (non uploadé) — l'upload se fait à la publication. */
  MediaEditor: { local: LocalMediaFile };
  /** Composeur multi-image de statuts (jusqu'à 6 photos, façon WhatsApp) :
   * carrousel + légende par image, publie chaque image comme une story
   * SÉPARÉE. Pas de recadrage/dessin/stickers ici (voir MediaEditor pour le
   * flux single-image complet). */
  MultiStoryComposer: { locals: LocalMediaFile[] };
  /** Aperçu d'un média avant envoi dans une conversation (crop + légende). */
  ChatMediaPreview: {
    conversationId: string;
    partnerId: string;
    senderId: string;
    local: LocalMediaFile;
  };
  /** Aperçu de PLUSIEURS photos avant envoi groupé dans une conversation —
   * grille de vignettes + une légende commune appliquée à la DERNIÈRE image
   * (façon WhatsApp). Chaque photo part comme un message séparé. */
  ChatMultiMediaPreview: {
    conversationId: string;
    partnerId: string;
    senderId: string;
    locals: LocalMediaFile[];
  };
  /** Galerie maison à sélection multiple (cases à cocher, badge d'ordre) —
   * remplace le sélecteur système. `token` relie l'appel à sa réponse. */
  GalleryPicker: { token: string; maxCount?: number };
  StoryViewer: { authorId: string };
  /** Repartage d'une story existante (mienne ou d'un contact) comme nouveau
   * statut, façon WhatsApp « Ajouter à mon statut » — légende éditable avant
   * publication. */
  StoryReshare: { story: Story };
  /** Page « Mes statuts » facon WhatsApp : liste de mes stories + leurs vues. */
  MyStatus: undefined;
  /** Liste des personnes ayant vu une de mes stories (+ leur reaction). */
  StoryViewers: { storyId: string };

  // ── Groupes & Chaînes ──────────────────────────────────────────────────
  /** Création d'un groupe ou d'une chaîne (type par défaut via `kind`). */
  CreateGroup: { kind?: GroupKind } | undefined;
  /** Liste « Voir tout » filtrée par type. */
  GroupsList: { kind?: GroupKind } | undefined;
  /** Chat d'un groupe / chaîne. */
  GroupChat: {
    groupId: string;
    name: string;
    /** Voir `Chat.jumpToMessageId` — même mécanique de "jump to message"
     * depuis l'écran de recherche. */
    jumpToMessageId?: string;
    jumpToCreatedAt?: string;
  };
  /** Détail : membres, invitation, quitter. */
  GroupInfo: { groupId: string };
  AddGroupMembers: { groupId: string };
  /** Paramètres d'un groupe / d'une chaîne (admins). */
  GroupSettings: { groupId: string };
  /** File des demandes d'adhésion à approuver (admins). */
  GroupJoinRequests: { groupId: string };
  /** Canal de discussion lié à une chaîne — créer/choisir/délier (admins). */
  ChannelDiscussion: { groupId: string };
  /** Abonnement payant d'une chaîne — activer/prix/devise (admins). */
  ChannelSubscription: { groupId: string };
  /** Annuaire des chaînes publiques, joignables sans invitation. */
  DiscoverChannels: undefined;
  /** QR code d'invitation d'un groupe / chaîne (à faire scanner). */
  GroupQr: { groupId: string };
  /** Écran plein écran de la diffusion en direct d'une chaîne (spectateur
   * ou diffuseur — `asBroadcaster` distingue les deux). */
  ChannelLiveViewer: { groupId: string; asBroadcaster?: boolean };
  /** Scanner QR d'invitation (ou saisie manuelle du code). */
  Scanner: undefined;
  /** Aperçu avant d'accepter de rejoindre. */
  JoinPreview: { code: string; preview?: GroupPreview };
  /** Visionneuse plein écran d'un média (pièce jointe de groupe, etc.). */
  MediaViewer: {
    url: string;
    type: 'image' | 'video';
    thumbnailUrl?: string;
    /** si fourni + média reçu -> on marque « ouvert » (écran Infos). */
    messageId?: string;
    /** Groupe d'images envoyées ensemble (voir MediaGroupBubble) : permet de
     * défiler précédent/suivant SANS revenir au fil de discussion — `index`
     * pointe sur `url` dans ce tableau. Images uniquement (jamais mêlé à
     * une vidéo/vue unique). */
    gallery?: { urls: string[]; index: number };
    /** vue unique (façon WhatsApp) : le fichier est téléchargé dans un
     * dossier TEMPORAIRE (pas le cache persistant), affiché, puis effacé
     * localement + confirmé "ouvert" au serveur (suppression définitive)
     * SEULEMENT à la fermeture de ce viewer — jamais avant, sinon le média
     * peut disparaître côté serveur avant même d'avoir fini de charger. */
    viewOnceMessageId?: string;
  };
  /** « Infos » d'un message envoyé : horodatages distribué / lu / écouté. */
  MessageInfo: { messageId: string; type: string };
  /** Recadrage d'image (cadre ajustable). `token` relie l'appel à sa réponse. */
  ImageCrop: { token: string; uri: string; circle?: boolean; aspect?: number; title?: string };

  // ── Rendez-vous (RDV) ────────────────────────────────────────────────────
  /** Liste des RDV (organisés ou reçus) avec filtres à venir/en cours/passés. */
  Appointments: undefined;
  /** Création d'un RDV — participants pré-remplis si ouvert depuis une conversation. */
  CreateAppointment: { preselectedUserIds?: string[] } | undefined;
  /** Détail d'un RDV : participants + statuts, actions accepter/refuser/annuler. */
  AppointmentDetail: { appointmentId: string };
  /** Notes du RDV — ajout/lecture/gestion, ouvert depuis le bouton dédié du
   * détail plutôt qu'affiché en place. */
  AppointmentNotes: { appointmentId: string };
};

/** Nav du stack principal, accessible depuis un ecran d'onglet. */
export type MainNav = NativeStackNavigationProp<MainStackParamList>;

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;
export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;
export type MainScreenProps<T extends keyof MainStackParamList> = NativeStackScreenProps<
  MainStackParamList,
  T
>;
