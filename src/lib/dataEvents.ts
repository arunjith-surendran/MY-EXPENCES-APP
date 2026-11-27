import { useEffect } from 'react';

/**
 * A nudge for open screens to reload after data changed underneath them: a backup was
 * restored, another account's data was cleared, or recurring payments were added.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function emitDataChanged() {
  for (const l of [...listeners]) l();
}

export function useDataChanged(onChange: Listener) {
  useEffect(() => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [onChange]);
}
