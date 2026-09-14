/**
 * Message d'échec affiché quand `startCall`/`acceptCall` rejette.
 *
 * `e.message` peut être un message technique brut (HTTP, ou pire — un
 * message natif du SDK LiveKit/WebRTC comme "client initiated disconnect",
 * qui n'a aucun sens pour l'utilisateur et ressemble à tort à "l'autre
 * personne s'est déconnectée"). On n'affiche donc JAMAIS `e.message`
 * directement à l'utilisateur — seulement en __DEV__, pour le débogage.
 */
export function callStartErrorMessage(e: unknown, genericMessage: string): string {
  if (__DEV__ && e instanceof Error && e.message) {
    return `${genericMessage}\n\n[dev] ${e.message}`;
  }
  return genericMessage;
}
