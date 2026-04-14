import { useSyncExternalStore, useCallback, useEffect, useRef, useContext } from 'react';
import type { ChangeEvent } from 'react';
import { useFormContext } from './context.js';
import { ArrayItemContext } from './array-item-context.js';
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
  const mountedRef = useRef(false);

  const arrayCtx = useContext(ArrayItemContext);
  const isItemScoped =
    arrayCtx !== null &&
    Object.values(arrayCtx.arraySpec.item.children).includes(spec);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (isItemScoped) {
        return arrayCtx!.arrayStore.subscribe(listener);
      }
      return store.subscribe(spec, listener);
    },
    [store, spec, isItemScoped, arrayCtx],
  );

  const cachedRef = useRef<{ value: Raw; error: string | null; isTouched: boolean }>({
    value: undefined as Raw,
    error: null,
    isTouched: false,
  });

  const getSnapshot = useCallback(() => {
    if (isItemScoped) {
      const value = arrayCtx!.arrayStore.get(spec, arrayCtx!.itemId) as Raw;
      const error = arrayCtx!.arrayStore.getItemFieldError(arrayCtx!.itemId, spec);
      const isTouched = false;
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
    }
    const value = store.get(spec) as Raw;
    const error = store.getError(spec);
    const isTouched = store.isTouched(spec);
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
  }, [store, spec, isItemScoped, arrayCtx]);

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
      if (isItemScoped) {
        arrayCtx!.arrayStore.set(spec, arrayCtx!.itemId, value);
      } else {
        store.set(spec, value, opts);
      }
    },
    [store, spec, isItemScoped, arrayCtx],
  );

  const setRef = useCallback(
    (element: HTMLElement | null) => {
      if (!isItemScoped) {
        store.setRef(spec, element);
      }
    },
    [store, spec, isItemScoped],
  );

  const reset = useCallback(
    () => {
      if (!isItemScoped) {
        store.reset(spec);
      }
    },
    [store, spec, isItemScoped],
  );

  // StrictMode double-effect guard: skip re-mounting on second effect call
  useEffect(() => {
    if (isItemScoped) return;
    if (mountedRef.current) return;
    mountedRef.current = true;

    const currentValue = store.get(spec);
    if (currentValue === undefined && options?.defaultValue !== undefined) {
      store.set(spec, options.defaultValue, { noValidate: true, noTouch: true });
    }

    if (options?.schema) {
      store.setSchema(spec, options.schema);
    }

    store.mount(spec);

    return () => {
      store.unmount(spec, spec.keepOnUnmount);
      if (options?.schema) {
        store.removeSchema(spec);
      }
      store.setRef(spec, null);
      mountedRef.current = false;
    };
  }, [store, spec]); // Deliberately excludes options to prevent re-mounting

  // alwaysValidate: re-runs validation on every render
  useEffect(() => {
    if (isItemScoped) return;
    if (spec.alwaysValidate) {
      store.validateSpec(spec);
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
