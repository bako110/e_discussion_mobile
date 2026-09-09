/**
 * TextEncoder/TextDecoder sont fournis nativement par Hermes (RN 0.72+) mais
 * absents de la config "lib" TypeScript par défaut (@react-native/typescript-
 * config, pas de "dom"). Déclaration minimale pour le module crypto, sans
 * toucher au tsconfig partagé.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}
