import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import type { GroupKind, GroupPreview } from '@/types';
import type { UploadedMedia } from '@/services';

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
  AppearanceSettings: undefined;
  StorageSettings: undefined;
  HelpSettings: undefined;
  AboutSettings: undefined;
  StoryComposer: undefined;
  /** Éditeur média (recadrage / dessin / légende / stickers) avant publication. */
  MediaEditor: { media: UploadedMedia };
  StoryViewer: { authorId: string };
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
  /** QR code d'invitation d'un groupe / chaîne (à faire scanner). */
  GroupQr: { groupId: string };
  /** Scanner QR d'invitation (ou saisie manuelle du code). */
  Scanner: undefined;
  /** Aperçu avant d'accepter de rejoindre. */
  JoinPreview: { code: string; preview?: GroupPreview };
  /** Visionneuse plein écran d'un média (pièce jointe de groupe, etc.). */
  MediaViewer: { url: string; type: 'image' | 'video'; thumbnailUrl?: string };
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
