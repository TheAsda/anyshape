import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useFormContext } from './context.js';
import type { FieldSpec } from '../specs/field.js';

interface UseRegisterReturn<Raw> {
  value: Raw;
  onChange: (
    valueOrEvent:
      | Raw
      | ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    options?: { noValidate?: boolean; noTouch?: boolean },
  ) => void;
  error: string | null;
  isTouched: boolean;
  setRef: (element: HTMLElement | null) => void;
  reset: () => void;
}

export function useRegister<Valid, Raw = Valid | undefined>(
  spec: FieldSpec<Valid, Raw>,
  options?: { schema?: unknown; defaultValue?: Raw },
): UseRegisterReturn<Raw> {
  const { store } = useFormContext();
  const specId = spec.id;
  const mountedRef = useRef(false);

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(specId, listener),
    [store, specId],
  );

  const cachedRef = useRef<{ value: Raw; error: string | null; isTouched: boolean }>({
    value: undefined as Raw,
    error: null,
    isTouched: false,
  });

  const getSnapshot = useCallback(() => {
    const value = store.get(specId) as Raw;
    const error = store.getError(specId);
    const isTouched = store.isTouched(specId);
    const prev = cachedRef.current;
    if (
      prev.value === value &&
      prev.error === error &&
      prev.isTouched === isTouched
    ) {
      return prev;
    }
    const next = { value, error, isTouched };
    cachedRef.current = next;
    return next;
  }, [store, specId]);

  const getServerSnapshot = useCallback(
    () => ({
      value: (options?.defaultValue ?? undefined) as Raw,
      error: null as string | null,
      isTouched: false,
    }),
    [options?.defaultValue],
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // onChange duck-types: accepts raw values and ChangeEvent
  const onChange = useCallback(
    (
      valueOrEvent:
        | Raw
        | ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      opts?: { noValidate?: boolean; noTouch?: boolean },
    ) => {
      let value: unknown;
      if (
        valueOrEvent != null &&
        typeof valueOrEvent === 'object' &&
        'target' in valueOrEvent
      ) {
        const target = (valueOrEvent as ChangeEvent<HTMLInputElement>).target;
        if (target.type === 'checkbox') {
          value = target.checked;
        } else {
          value = target.value;
        }
      } else {
        value = valueOrEvent;
      }
      store.set(specId, value, opts);
    },
    [store, specId],
  );

  const setRef = useCallback(
    (element: HTMLElement | null) => {
      store.setRef(specId, element);
    },
    [store, specId],
  );

  const reset = useCallback(
    () => store.reset(specId),
    [store, specId],
  );

  // StrictMode double-effect guard: skip re-mounting on second effect call
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const currentValue = store.get(specId);
    if (currentValue === undefined && options?.defaultValue !== undefined) {
      store.set(specId, options.defaultValue, { noValidate: true, noTouch: true });
    }

    if (options?.schema) {
      store.setSchema(specId, options.schema);
    }

    store.mount(specId);

    return () => {
      store.unmount(specId, spec.keepOnUnmount);
      if (options?.schema) {
        store.removeSchema(specId);
      }
      store.setRef(specId, null);
      mountedRef.current = false;
    };
  }, [store, specId]); // Deliberately excludes options to prevent re-mounting

  // alwaysValidate: re-runs validation on every render
  useEffect(() => {
    if (spec.alwaysValidate) {
      store.validateSpec(specId);
    }
  });

  return {
    value: state.value,
    onChange,
    error: state.error,
    isTouched: state.isTouched,
    setRef,
    reset,
  };
}
