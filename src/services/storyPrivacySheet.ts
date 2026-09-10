/**
 * Confidentialité des statuts — bottom sheet (pas d'écran dédié).
 *
 *   import { openStoryPrivacySheet } from '@/services/storyPrivacySheet';
 *   openStoryPrivacySheet();   // liste les 3 modes ; applique le choix
 *
 * Modes façon WhatsApp :
 *  - contacts          : tous mes contacts (choix immédiat) ;
 *  - contacts_except   : tous SAUF une liste  -> ouvre la sélection de contacts ;
 *  - only              : UNIQUEMENT une liste -> ouvre la sélection de contacts.
 */
import i18n from '@/i18n';
import { showSheet, showAlert } from '@/components/common';
import { selectContacts } from '@/screens/Main/SelectContactsScreen';
import { storyService } from '@/services';
import type { StoryAudience, StoryAudienceMode } from '@/services/storyService';

async function applyMode(mode: StoryAudienceMode): Promise<void> {
  const t = i18n.t.bind(i18n);
  const current = storyService.readAudienceCache();

  if (mode === 'contacts') {
    await save({ mode: 'contacts', contact_ids: [] });
    return;
  }

  const ids = await selectContacts({
    title:
      mode === 'contacts_except'
        ? t('storyPrivacy.exceptTitle')
        : t('storyPrivacy.onlyTitle'),
    preselected: current.mode === mode ? current.contact_ids : [],
  });
  if (ids == null) return; // annulé -> on ne change rien
  await save({ mode, contact_ids: ids });
}

async function save(next: StoryAudience): Promise<void> {
  try {
    await storyService.setAudience(next); // local-first + outbox
  } catch {
    showAlert(i18n.t('errors.generic'));
  }
}

/** Ouvre le bottom sheet de confidentialité des statuts. */
export function openStoryPrivacySheet(onChanged?: () => void): void {
  const t = i18n.t.bind(i18n);
  const cur = storyService.readAudienceCache().mode;
  const MODES: StoryAudienceMode[] = ['contacts', 'contacts_except', 'only'];

  showSheet({
    title: t('storyPrivacy.whoCanSee'),
    actions: MODES.map((m) => ({
      label: t(`storyPrivacy.mode_${m}`) + (m === cur ? '  ✓' : ''),
      icon:
        m === 'only'
          ? 'account-lock-outline'
          : m === 'contacts_except'
            ? 'account-cancel-outline'
            : 'account-multiple-outline',
      onPress: () => {
        void applyMode(m).then(() => onChanged?.());
      },
    })),
  });
}
