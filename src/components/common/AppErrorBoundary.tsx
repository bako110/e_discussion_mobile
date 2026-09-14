/**
 * Filet de sécurité global : si une exception JS non gérée traverse tout
 * l'arbre React (RootNavigator, CallProvider…), affiche un écran de secours
 * au lieu de laisser React démonter tout le rendu — ce qui, en build
 * release (pas de red-box), se manifeste comme « l'app a cessé de
 * fonctionner » plutôt qu'un plantage visible et diagnosticable.
 *
 * Cas identifié qui en avait le plus besoin : un tap sur une notification
 * d'appel entrant pendant que l'app est SEULEMENT en arrière-plan (pas
 * tuée) fait démarrer la tâche headless de notifee EN MÊME TEMPS que
 * `MainActivity` revient au premier plan (mêmes listeners AppState, même
 * pont React) — une fenêtre de concurrence qui peut lever une exception que
 * rien n'attrapait jusqu'ici.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.warn('[AppErrorBoundary] exception non gérée:', error, info.componentStack);
  }

  private reset = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Une erreur est survenue</Text>
        <Text style={styles.body}>
          Désolé, quelque chose s'est mal passé. Réessayez — si le problème
          persiste, redémarrez l'application.
        </Text>
        <Pressable style={styles.retryBtn} onPress={this.reset}>
          <Text style={styles.retryTxt}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#fff',
  },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, color: '#666', textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#128C7E',
  },
  retryTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
