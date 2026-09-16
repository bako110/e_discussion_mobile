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
  };
  /** Détail / paramètres d'une conversation (contact, médias, sourdine…). */
  ConversationInfo: {
    conversationId: string;
    partnerId: string;
    partnerName: string;
    partnerAvatar?: string | null;
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
  /** Aperçu d'un média avant envoi dans une conversation (crop + légende). */
  ChatMediaPreview: {
    conversationId: string;
    partnerId: string;
    senderId: string;
    local: LocalMediaFile;
  };
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
  GroupChat: { groupId: string; name: string };
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
  };
  /** « Infos » d'un message envoyé : horodatages distribué / lu / écouté. */
  MessageInfo: { messageId: string; type: string };
  /** Recadrage d'image (cadre ajustable). `token` relie l'appel à sa réponse. */
  ImageCrop: { token: string; uri: string; circle?: boolean; aspect?: number; title?: string };
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
