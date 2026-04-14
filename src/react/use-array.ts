import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useFormContext } from './context.js';
import { ArrayStore } from '../store/array-store.js';
import type { ArraySpec } from '../specs/array.js';
import type { ObjectSpec, ObjectSpecChildren } from '../specs/object.js';

interface UseArrayOptions {
  spec: ArraySpec<ObjectSpec<ObjectSpecChildren>>;
  defaultValue?: Record<string, unknown>[];
}

interface UseArrayReturn {
  items: Array<{ id: string }>;
  append: (data?: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  upsert: (id: string, data: Record<string, unknown>) => string;
  clear: () => void;
  arrayStore: ArrayStore;
}

export function useArray(options: UseArrayOptions): UseArrayReturn {
  const { store } = useFormContext();
  const { spec, defaultValue } = options;

  const storeRef = useRef<ArrayStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new ArrayStore(store, spec, { defaultValue });
  }
  const arrayStore = storeRef.current;

  const subscribe = useCallback(
    (listener: () => void) => arrayStore.subscribe(listener),
    [arrayStore],
  );

  const cachedRef = useRef<Array<{ id: string }>>([]);

  const getSnapshot = useCallback(() => {
    const items = arrayStore.getItems();
    const prev = cachedRef.current;
    if (
      items.length === prev.length &&
      items.every((item, i) => item.id === prev[i].id)
    ) {
      return prev;
    }
    cachedRef.current = items;
    return items;
  }, [arrayStore]);

  const getServerSnapshot = useCallback(
    () => [] as Array<{ id: string }>,
    [],
  );

  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const append = useCallback(
    (data?: Record<string, unknown>) => arrayStore.append(data),
    [arrayStore],
  );
  const remove = useCallback(
    (id: string) => arrayStore.remove(id),
    [arrayStore],
  );
  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => arrayStore.reorder(fromIndex, toIndex),
    [arrayStore],
  );
  const upsert = useCallback(
    (id: string, data: Record<string, unknown>) => arrayStore.upsert(id, data),
    [arrayStore],
  );
  const clear = useCallback(
    () => arrayStore.clear(),
    [arrayStore],
  );

  return { items, append, remove, reorder, upsert, clear, arrayStore };
}
