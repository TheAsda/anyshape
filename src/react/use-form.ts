import { useRef, useCallback, createElement } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { FormStore } from '../store/form-store.js';
import { FormContext } from './context.js';
import type { BaseSpec } from '../specs/base.js';

interface UseFormReturn {
  store: FormStore;
  Provider: ({ children }: { children: ReactNode }) => React.JSX.Element;
  handleSubmit: (onValid: (values: Record<string, unknown>) => void) => (e?: FormEvent) => void;
}

export function useForm(
  formDefinition: Record<string, BaseSpec>,
  initialData?: Record<string, unknown>,
): UseFormReturn {
  const storeRef = useRef<FormStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new FormStore(formDefinition, initialData);
  }
  const store = storeRef.current;

  const Provider = useCallback(
    ({ children }: { children: ReactNode }) => {
      return createElement(FormContext.Provider, { value: { store } }, children);
    },
    [store],
  );

  const handleSubmit = useCallback(
    (onValid: (values: Record<string, unknown>) => void) => {
      return (e?: FormEvent) => {
        e?.preventDefault?.();
        store.submit(onValid);
      };
    },
    [store],
  );

  return { store, Provider, handleSubmit };
}
