import { createContext, useContext } from 'react';
import type { FormStore } from '../store/form-store.js';

interface FormContextValue {
  store: FormStore;
}

export const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext(): FormContextValue {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error('useFormContext must be used within a FormProvider');
  return ctx;
}
