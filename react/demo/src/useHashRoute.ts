import { useState, useEffect } from 'react';

/**
 * Returns the current `window.location.hash` and re-renders whenever it changes.
 * Normalises '#/' → '' so the root route maps to the connect control.
 */
export function useHashRoute(): string {
  const getHash = () => {
    const hash = window.location.hash;
    // Treat bare '#' or '#/' as the root (connect control)
    return hash === '#/' || hash === '#' ? '' : hash;
  };

  const [route, setRoute] = useState<string>(getHash);

  useEffect(() => {
    const handler = () => setRoute(getHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return route;
}
