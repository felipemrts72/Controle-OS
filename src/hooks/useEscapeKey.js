import { useEffect } from 'react';

export function useEscapeKey(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined;

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onEscape();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onEscape]);
}
