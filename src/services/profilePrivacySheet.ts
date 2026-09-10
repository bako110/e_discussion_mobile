/**
 * Confidentialité d'un champ de profil (En ligne / Dernière connexion / Photo
 * / À propos) — bottom sheet, façon WhatsApp actuel :
 *
 *   Tout le monde  /  Tout le monde sauf…  /  Uniquement…
 *   (+ « Comme la dernière connexion » pour le champ « En ligne »)
 *
 * Les modes « sauf » / « uniquement » enchaînent sur SelectContactsScreen.
 * Local-first : appliqué au cache tout de suite, PUT rejoué par l'outbox.
 */
import i18n from '@/i18n';
import { showSheet, showAlert } from '@/components/common';
import { selectContacts } from '@/screens/Main/SelectContactsScreen';
import { userService } from '@/services';
import type { PrivacyField, PrivacyMode } from '@/services/userService';

const T = () => i18n.t.bind(i18n);

async function apply(
  field: PrivacyField,
  mode: PrivacyMode,
  onChanged?: () => void,
): Promise<void> {
  const t = T();
  const cur = userService.readPrivacyCache()[field];

  if (mode === 'everyone' || mode === 'nobody' || mode === 'match_last_seen') {
    await save(field, mode, [], onChanged);
    return;
  }
  const ids = await selectContacts({
    title:
      mode === 'everyone_except'
        ? t('profilePrivacy.exceptTitle')
        : t('profilePrivacy.onlyTitle'),
    preselected: cur.mode === mode ? cur.contact_ids : [],
  });
  if (ids == null) return;
  await save(field, mode, ids, onChanged);
}

async function save(
  field: PrivacyField,
  mode: PrivacyMode,
  ids: string[],
  onChanged?: () => void,
): Promise<void> {
  try {
    await userService.setPrivacyField(field, mode, ids);
    onChanged?.();
  } catch {
    showAlert(i18n.t('errors.generic'));
  }
}

/** Ouvre le sheet de confidentialité pour un champ. */
export function openProfilePrivacySheet(
  field: PrivacyField,
  onChanged?: () => void,
): void {
  const t = T();
  const cur = userService.readPrivacyCache()[field].mode;

  const modes: PrivacyMode[] =
    field === 'online'
      ? ['match_last_seen', 'everyone', 'everyone_except', 'only', 'nobody']
      : ['everyone', 'everyone_except', 'only', 'nobody'];

  showSheet({
    title: t(`profilePrivacy.field_${field}`),
    actions: modes.map((m) => ({
      label: t(`profilePrivacy.mode_${m}`) + (m === cur ? '  ✓' : ''),
      icon:
        m === 'only'
          ? 'account-lock-outline'
          : m === 'everyone_except'
            ? 'account-cancel-outline'
            : m === 'nobody'
              ? 'lock-outline'
              : m === 'match_last_seen'
                ? 'clock-outline'
                : 'earth',
      onPress: () => {
        void apply(field, m, onChanged);
      },
    })),
  });
}

/** Libellé court du mode courant d'un champ (pour la ligne de réglage). */
export function privacyModeLabel(field: PrivacyField): string {
  const s = userService.readPrivacyCache()[field];
  const base = i18n.t(`profilePrivacy.mode_${s.mode}`);
  if ((s.mode === 'everyone_except' || s.mode === 'only') && s.contact_ids.length) {
    return `${base} (${s.contact_ids.length})`;
  }
  return base;
}
