import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import { useFormContext } from './context.js';
import type { MetaSpec } from '../specs/meta.js';

interface UseMetaReturn<Value> {
  value: Value | undefined;
  setValue: (value: Value) => void;
}

export function useMeta<Value>(spec: MetaSpec<Value>): UseMetaReturn<Value> {
  const { store } = useFormContext();

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(spec, listener),
    [store, spec],
  );

  const cachedRef = useRef<{ value: Value | undefined }>({ value: undefined });

  const getSnapshot = useCallback(() => {
    const value = store.get(spec) as Value | undefined;
    if (cachedRef.current.value === value) {
      return cachedRef.current;
    }
    const next = { value };
    cachedRef.current = next;
    return next;
  }, [store, spec]);

  const getServerSnapshot = useCallback(
    () => ({ value: undefined as Value | undefined }),
    [],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (value: Value) => {
      store.set(spec, value, { noValidate: true, noTouch: true });
    },
    [store, spec],
  );

  useEffect(() => {
    store.mount(spec);
    return () => {
      store.unmount(spec);
    };
  }, [store, spec]);

  return { value: state.value, setValue };
}
