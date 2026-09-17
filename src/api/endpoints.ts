/** Endpoints alignés sur le backend E-discussion (prefix /api/v1). */
const V1 = '/api/v1';

export const Endpoints = {
  auth: {
    // Flux principal : telephone sans mot de passe
    phoneStart: `${V1}/auth/phone/start`,
    phoneVerify: `${V1}/auth/phone/verify`,
    // OTP generique (utilise pour lier un e-mail / un numero secondaire)
    otpSend: `${V1}/auth/otp/send`,
    otpVerify: `${V1}/auth/otp/verify`,
    // Liaison d'identifiants secondaires au compte courant
    linkPhone: `${V1}/auth/phone/link`,
    linkEmail: `${V1}/auth/email/link`,
    // Divers
    refresh: `${V1}/auth/refresh`,
    logout: `${V1}/auth/logout`,
    me: `${V1}/auth/me`,
    exportMe: `${V1}/auth/me/export`,
    deleteMe: `${V1}/auth/me`,
  },
  users: {
    updateMe: `${V1}/users/me`,
    privacy: `${V1}/users/me/privacy`,
    search: (q: string) => `${V1}/users/search?q=${encodeURIComponent(q)}`,
    blocked: `${V1}/users/blocked`,
    byId: (id: string) => `${V1}/users/${id}`,
    block: (id: string) => `${V1}/users/${id}/block`,
    report: (id: string) => `${V1}/users/${id}/report`,
  },
  contacts: {
    list: `${V1}/contacts`,
    sync: `${V1}/contacts/sync`,
  },
  conversations: {
    list: `${V1}/conversations`,
    start: `${V1}/conversations`,
    detail: (id: string) => `${V1}/conversations/${id}`,
    byId: (id: string) => `${V1}/conversations/${id}`,
    accept: (id: string) => `${V1}/conversations/${id}/accept`,
    decline: (id: string) => `${V1}/conversations/${id}/decline`,
    retry: (id: string) => `${V1}/conversations/${id}/retry`,
    mute: (id: string) => `${V1}/conversations/${id}/mute`,
    hide: (id: string) => `${V1}/conversations/${id}/hide`,
    messages: (id: string) => `${V1}/conversations/${id}/messages`,
    read: (id: string) => `${V1}/conversations/${id}/read`,
    media: (id: string) => `${V1}/conversations/${id}/media`,
    clear: (id: string) => `${V1}/conversations/${id}`,
    pinned: (id: string) => `${V1}/conversations/${id}/pinned`,
    unpin: (id: string, messageId: string) => `${V1}/conversations/${id}/pinned/${messageId}`,
  },
  messages: {
    byId: (id: string) => `${V1}/messages/${id}`,
    edit: (id: string) => `${V1}/messages/${id}`,
    react: (id: string) => `${V1}/messages/${id}/react`,
    delivered: (id: string) => `${V1}/messages/${id}/delivered`,
    played: (id: string) => `${V1}/messages/${id}/played`,
    openViewOnce: (id: string) => `${V1}/messages/${id}/view-once/open`,
    info: (id: string) => `${V1}/messages/${id}/info`,
  },
  stories: {
    feed: `${V1}/stories/feed`,
    mine: `${V1}/stories/mine`,
    create: `${V1}/stories`,
    audience: `${V1}/stories/audience`,
    byId: (id: string) => `${V1}/stories/${id}`,
    view: (id: string) => `${V1}/stories/${id}/view`,
    viewers: (id: string) => `${V1}/stories/${id}/viewers`,
    react: (id: string) => `${V1}/stories/${id}/react`,
    reply: (id: string) => `${V1}/stories/${id}/reply`,
    reshare: (id: string) => `${V1}/stories/${id}/reshare`,
  },
  media: {
    upload: `${V1}/media/upload`,
  },
  groups: {
    list: `${V1}/groups`,
    listByKind: (kind: 'group' | 'channel') => `${V1}/groups?kind=${kind}`,
    create: `${V1}/groups`,
    preview: (code: string) => `${V1}/groups/preview?code=${encodeURIComponent(code)}`,
    join: `${V1}/groups/join`,
    byId: (id: string) => `${V1}/groups/${id}`,
    members: (id: string) => `${V1}/groups/${id}/members`,
    memberRole: (id: string, userId: string) => `${V1}/groups/${id}/members/${userId}/role`,
    removeMember: (id: string, userId: string) => `${V1}/groups/${id}/members/${userId}`,
    inviteReset: (id: string) => `${V1}/groups/${id}/invite/reset`,
    leave: (id: string) => `${V1}/groups/${id}/leave`,
    mute: (id: string) => `${V1}/groups/${id}/mute`,
    unmute: (id: string) => `${V1}/groups/${id}/unmute`,
    messages: (id: string) => `${V1}/groups/${id}/messages`,
    message: (id: string, messageId: string) => `${V1}/groups/${id}/messages/${messageId}`,
    reactMessage: (id: string, messageId: string) =>
      `${V1}/groups/${id}/messages/${messageId}/react`,
    pinned: (id: string) => `${V1}/groups/${id}/pinned`,
    unpin: (id: string, messageId: string) => `${V1}/groups/${id}/pinned/${messageId}`,
    read: (id: string) => `${V1}/groups/${id}/read`,
    settings: (id: string) => `${V1}/groups/${id}/settings`,
    joinRequests: (id: string) => `${V1}/groups/${id}/join-requests`,
    approveJoin: (id: string, userId: string) =>
      `${V1}/groups/${id}/join-requests/${userId}/approve`,
    rejectJoin: (id: string, userId: string) =>
      `${V1}/groups/${id}/join-requests/${userId}/reject`,
    // ── diffusion en direct (chaînes) ──────────────────────────────────
    liveList: `${V1}/groups/live`,
    live: (id: string) => `${V1}/groups/${id}/live`,
    liveJoin: (id: string) => `${V1}/groups/${id}/live/join`,
    liveStop: (id: string) => `${V1}/groups/${id}/live/stop`,
    // ── discussion liée & découverte (chaînes) ─────────────────────────
    discussion: (id: string) => `${V1}/groups/${id}/discussion`,
    unlinkDiscussion: (id: string, discussionGroupId: string) =>
      `${V1}/groups/${id}/discussion/${discussionGroupId}`,
    myLinkedChannels: (id: string) => `${V1}/groups/${id}/discussion/mine`,
    discover: (params: { category?: string; query?: string }) => {
      const q = new URLSearchParams();
      if (params.category) q.set('category', params.category);
      if (params.query) q.set('query', params.query);
      const qs = q.toString();
      return `${V1}/groups/discover${qs ? `?${qs}` : ''}`;
    },
  },
  calls: {
    config: `${V1}/calls/config`,
    history: `${V1}/calls`,
    start: `${V1}/calls`,
    clear: `${V1}/calls`,
    clearStuck: `${V1}/calls/clear-stuck`,
    byId: (id: string) => `${V1}/calls/${id}`,
    accept: (id: string) => `${V1}/calls/${id}/accept`,
    reject: (id: string, reason?: string) =>
      `${V1}/calls/${id}/reject${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`,
    cancel: (id: string) => `${V1}/calls/${id}/cancel`,
    hangup: (id: string) => `${V1}/calls/${id}/hangup`,
    rating: (id: string) => `${V1}/calls/${id}/rating`,
  },
  appointments: {
    list: (status?: string) => `${V1}/appointments${status ? `?status=${status}` : ''}`,
    create: `${V1}/appointments`,
    byId: (id: string) => `${V1}/appointments/${id}`,
    accept: (id: string) => `${V1}/appointments/${id}/accept`,
    decline: (id: string) => `${V1}/appointments/${id}/decline`,
    cancel: (id: string) => `${V1}/appointments/${id}/cancel`,
  },
  devices: {
    registerKeys: `${V1}/devices/keys`,
    addPrekeys: `${V1}/devices/keys/one-time-prekeys`,
    myKeysCount: `${V1}/devices/me/keys-count`,
    mine: `${V1}/devices/me`,
    pushToken: `${V1}/devices/push-token`,
    bundles: (userId: string) => `${V1}/devices/${userId}/bundles`,
    revoke: (deviceId: string) => `${V1}/devices/${deviceId}/keys`,
  },
} as const;
