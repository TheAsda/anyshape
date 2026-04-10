import { useSyncExternalStore, useCallback, useEffect } from 'react';
import { useFormContext } from './context.js';
import type { MetaSpec } from '../specs/meta.js';

interface UseMetaReturn<Value> {
  value: Value | undefined;
  setValue: (value: Value) => void;
}

export function useMeta<Value>(spec: MetaSpec<Value>): UseMetaReturn<Value> {
  const { store } = useFormContext();
  const specId = spec.id;

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(specId, listener),
    [store, specId],
  );

  const getSnapshot = useCallback(
    () => ({ value: store.get(specId) as Value | undefined }),
    [store, specId],
  );

  const getServerSnapshot = useCallback(
    () => ({ value: undefined as Value | undefined }),
    [],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (value: Value) => {
      store.set(specId, value, { noValidate: true, noTouch: true });
    },
    [store, specId],
  );

  useEffect(() => {
    store.mount(specId);
    return () => {
      store.unmount(specId);
    };
  }, [store, specId]);

  return { value: state.value, setValue };
}
