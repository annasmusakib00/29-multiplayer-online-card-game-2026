import { useSyncExternalStore } from 'react';
import { getClient } from './GameClient';

// Re-render whenever the engine commits a change; components read client.state.
export function useGame() {
  const client = getClient();
  useSyncExternalStore(client.subscribe, client.getVersion);
  return client;
}
