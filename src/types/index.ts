/** Types partagés — miroir des schemas Pydantic du backend. */

export interface UserPublic {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  last_seen_at: string | null;
  is_online: boolean;
}

export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';

export interface UserMe extends UserPublic {
  email: string | null;
  phone: string | null;
  locale: string;
  email_verified: boolean;
  phone_verified: boolean;
  last_seen_privacy: PrivacyLevel;
  profile_photo_privacy: PrivacyLevel;
  about_privacy: PrivacyLevel;
  read_receipts: boolean;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: UserMe;
  /** false = compte cree a l'instant, il faut encore renseigner nom + username. */
  profile_complete: boolean;
  is_new_user: boolean;
}

export interface PhoneStartOut {
  phone: string; // E.164 normalise cote serveur
  sent: boolean;
  resend_in: number;
}

export type MessageType = 'text' | 'voice' | 'image' | 'video' | 'file' | 'sticker' | 'location';

export interface ReplyPreview {
  id: string;
  type: MessageType;
  body: string;
  sender_id: string;
}

export interface ChatMessage {
  id: string;
  client_id?: string | null;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  body: string;
  encrypted: boolean;
  attachment_url: string | null;
  attachment_meta: Record<string, unknown> | null;
  reply_to: ReplyPreview | null;
  forwarded_from_id: string | null;
  reaction: string | null;
  delivered: boolean;
  read: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  // client-only
  pending?: boolean;
  decrypted?: boolean;
  decryptFailed?: boolean;
}

export type RequestStatus =
  | 'accepted'
  | 'pending_incoming'
  | 'pending_outgoing'
  | 'declined';

export interface ConversationSummary {
  id: string;
  partner: UserPublic;
  last_message: string | null;
  last_message_type: MessageType | null;
  last_message_at: string | null;
  last_message_encrypted: boolean;
  unread_count: number;
  muted: boolean;
  request_status: RequestStatus;
}

export interface ConversationDetail {
  id: string;
  partner: UserPublic;
  muted: boolean;
  request_status: RequestStatus;
}

export interface ContactMatch {
  phone: string;
  display_name: string | null;
  user: UserPublic | null;
}

// ── Stories ────────────────────────────────────────────────────────────────
export type StoryMediaType = 'text' | 'image' | 'video' | 'audio' | 'voice';
export type StoryAudience = 'everyone' | 'contacts';

export interface Story {
  id: string;
  author_id: string;
  media_type: StoryMediaType;
  media_url: string | null;
  caption: string | null;
  background_color: string | null;
  font: string | null;
  duration_sec: number;
  thumbnail_url: string | null;
  audio_url: string | null;
  audio_name: string | null;
  audience: StoryAudience;
  created_at: string;
  expires_at: string;
  edited_at: string | null;
  view_count: number;
  reaction_count: number;
  seen_by_me: boolean;
  my_reaction: string | null;
  is_mine: boolean;
}

export interface StoryFeedItem {
  author: UserPublic;
  stories: Story[];
  has_unseen: boolean;
  latest_at: string;
}

export interface StoryViewer {
  user: UserPublic;
  viewed_at: string;
  reaction: string | null;
}

export interface CreateStoryInput {
  media_type?: StoryMediaType;
  media_url?: string | null;
  caption?: string | null;
  background_color?: string | null;
  font?: string | null;
  duration_sec?: number;
  thumbnail_url?: string | null;
  audio_url?: string | null;
  audio_name?: string | null;
  audience?: StoryAudience;
}

// ── Groupes & Chaînes ─────────────────────────────────────────────────────
export type GroupKind = 'group' | 'channel';
export type GroupRole = 'owner' | 'admin' | 'member' | 'subscriber';

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  description: string | null;
  avatar_url: string | null;
  owner_id: string;
  invite_code: string;
  is_public: boolean;
  created_at: string;
  last_message_at: string | null;
  member_count: number;
  unread_count: number;
  my_role: GroupRole | null;
  last_message_preview: string | null;
  can_post: boolean;
}

export interface GroupMember {
  user: UserPublic;
  role: GroupRole;
  joined_at: string;
  muted: boolean;
}

export interface GroupPreview {
  id: string;
  kind: GroupKind;
  name: string;
  description: string | null;
  avatar_url: string | null;
  member_count: number;
  is_member: boolean;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  sender: UserPublic | null;
  client_id: string | null;
  type: 'text' | 'image' | 'video' | 'system';
  body: string;
  attachment_url: string | null;
  attachment_meta: Record<string, unknown> | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  // client-only
  pending?: boolean;
}

export interface CreateGroupInput {
  kind: GroupKind;
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  is_public?: boolean;
  member_ids?: string[];
}

// ── Appels WebRTC (LiveKit self-hosted) ──────────────────────────────────
export type CallType = 'voice' | 'video';
export type CallStatus =
  | 'ringing'
  | 'active'
  | 'ended'
  | 'missed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface CallLog {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: CallType;
  status: CallStatus;
  room_name: string;
  duration_sec: number;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  peer: UserPublic | null;
}

/** Réponse de POST /calls : inclut l'accès LiveKit de l'appelant. */
export interface CallStart extends CallLog {
  livekit_url: string;
  token: string;
  e2ee_key: string | null;
}

/** Réponse de POST /calls/{id}/accept : accès LiveKit du destinataire. */
export interface CallToken {
  livekit_url: string;
  token: string;
  room_name: string;
  call_type: CallType;
  e2ee_key: string | null;
  peer: UserPublic | null;
}

export interface CallsConfig {
  enabled: boolean;
  livekit_url: string | null;
  ring_timeout: number;
}

// ── Appareils liés (E2E) ─────────────────────────────────────────────────
export interface LinkedDevice {
  device_id: string;
  device_label: string | null;
  registration_id: number;
  revoked: boolean;
  created_at: string;
  updated_at: string;
  remaining_one_time_prekeys: number;
  is_current: boolean;
}
