import { useEffect, useState } from 'react';

/** Re-renders when a small module-level store changes. */
export function useStore<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T): T {
  const [value, setValue] = useState(getSnapshot);
  useEffect(() => {
    const update = () => setValue(getSnapshot());
    update();
    return subscribe(update);
    // The store functions are module-level and never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
