import type { LinkingOptions } from '@react-navigation/native';

import type { MainStackParamList } from './types';

/**
 * Deep-linking : `gofolyx://join/<invite_code>` (QR code / lien partagé) ouvre
 * l'écran d'aperçu d'un groupe / chaîne.
 *
 * ⚠️ On NE traite QUE les URL `gofolyx://join/...`. Toute autre URL entrante
 * (notamment les `content://` renvoyés par la galerie via image-picker, qui
 * repassent par `MainActivity`) est ignorée — sinon React Navigation tente de
 * router dessus, échoue, et déclenche un `GO_BACK` qui vide la pile.
 */
export const APP_SCHEME = 'gofolyx';

export const linking: LinkingOptions<MainStackParamList> = {
  prefixes: [`${APP_SCHEME}://`],

  // Ne réagit qu'aux liens d'invitation ; tout le reste -> pas de navigation.
  getStateFromPath: (path) => {
    const m = path.match(/(?:^|\/)join\/([A-Za-z0-9_-]{4,16})/);
    if (!m) return undefined;
    return {
      routes: [{ name: 'JoinPreview', params: { code: m[1] } }],
    } as ReturnType<NonNullable<LinkingOptions<MainStackParamList>['getStateFromPath']>>;
  },

  config: {
    screens: {
      JoinPreview: 'join/:code',
    },
  },
};
