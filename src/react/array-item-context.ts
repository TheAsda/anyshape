import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import type { ArrayStore } from '../store/array-store.js';
import type { ArraySpec } from '../specs/array.js';
import type { ObjectSpec, ObjectSpecChildren } from '../specs/object.js';

interface ArrayItemContextValue {
  arrayStore: ArrayStore;
  itemId: string;
  arraySpec: ArraySpec<ObjectSpec<ObjectSpecChildren>>;
}

export const ArrayItemContext = createContext<ArrayItemContextValue | null>(null);

export function useArrayItemContext(): ArrayItemContextValue {
  const ctx = useContext(ArrayItemContext);
  if (!ctx) throw new Error('useArrayItemContext must be used within an ArrayItemProvider');
  return ctx;
}

export function ArrayItemProvider({ arrayStore, itemId, arraySpec, children }: {
  arrayStore: ArrayStore;
  itemId: string;
  arraySpec: ArraySpec<ObjectSpec<ObjectSpecChildren>>;
  children: ReactNode;
}): React.ReactElement {
  const contextValue = { arrayStore, itemId, arraySpec };
  return createElement(ArrayItemContext.Provider, { value: contextValue }, children);
}