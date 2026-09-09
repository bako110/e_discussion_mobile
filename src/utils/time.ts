import i18n from '@/i18n';

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const min = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (min < 1) return i18n.t('common.loading') === '…' ? '' : 'now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return i18n.t('common.yesterday');
  if (days < 7) return d.toLocaleDateString(i18n.language, { weekday: 'short' });
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Libellé de présence pour l'en-tête de conversation.
 *  - en ligne              → « en ligne »
 *  - vu il y a < 60 s      → « en ligne » (tolérance battement de cœur)
 *  - vu il y a < 1 h       → « vu il y a N min »
 *  - même jour             → « vu à HH:MM »
 *  - hier                  → « vu hier à HH:MM »
 *  - < 7 jours             → « vu <jour> à HH:MM »
 *  - au-delà               → « vu le JJ/MM/AAAA »
 */
export function lastSeenLabel(iso: string | null, isOnline: boolean): string {
  if (isOnline) return i18n.t('common.online');
  if (!iso) return i18n.t('common.offline');
  const d = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (Number.isNaN(sec)) return i18n.t('common.offline');
  if (sec < 60) return i18n.t('common.online');

  const min = Math.floor(sec / 60);
  if (min < 60) return i18n.t('presence.seenMinutes', { count: min });

  const at = d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return i18n.t('presence.seenAt', { time: at });

  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) {
    return i18n.t('presence.seenYesterday', { time: at });
  }

  const days = Math.floor(sec / 86400);
  if (days < 7) {
    const wd = d.toLocaleDateString(i18n.language, { weekday: 'long' });
    return i18n.t('presence.seenWeekday', { day: wd, time: at });
  }

  const date = d.toLocaleDateString(i18n.language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return i18n.t('presence.seenDate', { date });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return i18n.t('common.today');
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return i18n.t('common.yesterday');
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });
}
