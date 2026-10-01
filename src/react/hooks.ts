// ============================================================
// React bindings – stores in context, reading and writing.
// ------------------------------------------------------------
//   • <StoreProvider store={...}> accepts any store: the root, an object
//     substore or a row store.
//   • Hooks resolve a reference from the nearest provided store (or the
//     explicit { store } option, which wins): template references resolve to
//     the provided row, references of enclosing scopes to their own store.
//   • Returns are generic – no native input bindings. fromInput / fromCheckbox
//     adapt an onChange to native events.
//   • When a control's error is shown is a display policy (useControl's
//     showError), set once with <StoreProvider showError={...}> and inherited
//     by nested providers. The default shows an error once the field is
//     revealed: on blur (useControl's onBlur) or by a submit.
// ============================================================

import {
  createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
  type ReactNode,
} from "react";
import { ShapeNode, type AnyNode, type InferValue, type InferMeta, type MetaRef } from "../shape";
import { ItemStore, type ArrayStore, type BaseStore, type AnyRef, type RefValue, type NewItemArgs, type WriteOptions } from "../store";
import type { FocusTarget } from "../features";
import type { ArrayNode } from "../shape";
import { refNode, refLabel, rootOf, scopeOf } from "../internal";

// ============================================================
// Context
// ============================================================
const StoreContext = createContext<BaseStore<any> | undefined>(undefined);

/** What an error display policy decides on: a control's current state. */
export interface ErrorDisplayState {
  error: string | undefined;
  touched: boolean;
  dirty: boolean;
  revealed: boolean;
  validating: boolean;
}

/** Decides whether a control shows its error (useControl's showError). */
export type ErrorDisplayPolicy = (state: ErrorDisplayState) => boolean;

/** Show an error once the field is revealed (blurred, or covered by a submit); then it stays live. */
export const defaultErrorDisplay: ErrorDisplayPolicy = (s) => s.error !== undefined && s.revealed;

const ErrorDisplayContext = createContext<ErrorDisplayPolicy>(defaultErrorDisplay);

export interface StoreProviderProps {
  store: BaseStore<any>;
  /** Error display policy for the controls below; inherited when omitted. */
  showError?: ErrorDisplayPolicy;
  children?: ReactNode;
}

/** Provide any store (root, object substore, row store) to the hooks below it. */
export function StoreProvider(props: StoreProviderProps): ReactNode {
  const children = props.showError
    ? createElement(ErrorDisplayContext.Provider, { value: props.showError }, props.children)
    : props.children;
  return createElement(StoreContext.Provider, { value: props.store }, children);
}

export interface HookOptions {
  /** Use this store instead of the provided one. */
  store?: BaseStore<any>;
}

/** The provided store (or options.store). Throws when there is none. */
export function useStore<S extends BaseStore<any> = BaseStore<any>>(options?: HookOptions): S {
  const provided = useContext(StoreContext);
  const store = options?.store ?? provided;
  if (!store) throw new Error("No store: render inside a <StoreProvider> or pass { store }");
  return store as S;
}

/**
 * The store that addresses `ref`, starting from `start`: the scope store (root
 * or row) of the reference's scope, found by walking up from `start`.
 */
export function resolveStore(start: BaseStore<any>, ref: AnyRef): BaseStore<any> {
  const node = refNode(ref);
  if (!(node instanceof ShapeNode) || node.id === undefined || rootOf(node) !== start.root.node) {
    throw new Error(`"${refLabel(ref)}" is not part of this form`);
  }
  const scope = scopeOf(node);
  for (let host = start._host; ; host = host.arrayStore._host) {
    if (host.node === scope) return host;
    if (!(host instanceof ItemStore)) break;
  }
  throw new Error(
    `"${refLabel(ref)}" is inside a row that the provided store cannot reach – ` +
      `render it under a <StoreProvider> for that row, or pass { store: row }`
  );
}

function useResolved(ref: AnyRef, options?: HookOptions): BaseStore<any> {
  const start = useStore(options);
  return useMemo(() => resolveStore(start, ref), [start, ref]);
}

// ============================================================
// useValue
// ============================================================
export interface SelectOptions<T> extends HookOptions {
  /** When the selected result is equal to the previous one, the component does not re-render. Default Object.is. */
  equals?: (a: T, b: T) => boolean;
}

/**
 * Read any reference: a node (its slice of the form), a meta key (effective
 * value for inherited keys), a count or an initial value. Re-renders only
 * when that value changes.
 */
export function useValue<R extends AnyRef>(ref: R, options?: HookOptions): RefValue<R>;
/** Read a derived value; re-renders only when the selected result changes. */
export function useValue<R extends AnyRef, T>(ref: R, select: (value: RefValue<R>) => T, options?: SelectOptions<T>): T;
export function useValue(
  ref: AnyRef,
  a?: HookOptions | ((value: unknown) => unknown),
  b?: SelectOptions<unknown>
): unknown {
  const select = typeof a === "function" ? a : undefined;
  const options = (typeof a === "function" ? b : a) as SelectOptions<unknown> | undefined;
  const store = useResolved(ref, options);
  const equals = options?.equals ?? Object.is;

  const subscribe = useCallback((listener: () => void) => store.subscribe(ref, listener), [store, ref]);
  // The last rendered selection, shared across renders so an inline selector
  // returning an equal object does not cause a re-render.
  const rendered = useRef<{ value: unknown } | null>(null);
  const getSnapshot = useMemo(() => {
    if (!select) return () => store.get(ref);
    let has = false;
    let input: unknown;
    let output: unknown;
    return () => {
      const next = store.get(ref);
      if (has && Object.is(next, input)) return output;
      const selected = select(next);
      has = true;
      input = next;
      output = rendered.current && equals(rendered.current.value, selected) ? rendered.current.value : selected;
      return output;
    };
  }, [store, ref, select, equals]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    rendered.current = { value };
  }, [value]);
  return value;
}

// ============================================================
// useField / useControl
// ============================================================
function useOwnMeta(store: BaseStore<any>, node: AnyNode): any {
  const subscribe = useCallback((listener: () => void) => store.subscribeMeta(node, listener), [store, node]);
  const get = useCallback(() => store.getMeta(node), [store, node]);
  return useSyncExternalStore(subscribe, get, get);
}

function useSetter<N extends AnyNode>(store: BaseStore<any>, node: N): (value: InferValue<N>) => void {
  return useCallback((value: InferValue<N>) => store.set(node, value, { origin: "user" }), [store, node]);
}

export interface FieldBinding<N extends AnyNode> {
  value: InferValue<N>;
  /** Stable; writes with origin "user". */
  onChange: (value: InferValue<N>) => void;
  /** The node's own meta (inherited keys: use useValue(node.key) for the effective value). */
  meta: Readonly<InferMeta<N>>;
  /** The store the field was resolved to. */
  store: BaseStore<any>;
}

/** Any node: value, onChange and its own meta. */
export function useField<N extends AnyNode>(node: N, options?: HookOptions): FieldBinding<N> {
  const store = useResolved(node, options);
  const value = useValue(node, { store }) as InferValue<N>;
  const meta = useOwnMeta(store, node);
  const onChange = useSetter(store, node);
  return { value, onChange, meta, store };
}

/** The control() keys and their values. */
interface ControlMeta {
  error: string | undefined;
  validating: boolean;
  touched: boolean;
  dirty: boolean;
  revealed: boolean;
  focusTarget: FocusTarget | undefined;
}

/** A node with the control() keys. */
export type ControlNode = AnyNode & { readonly [K in keyof ControlMeta]: MetaRef<ControlMeta[K]> };

export interface ControlBinding<N extends ControlNode> {
  value: InferValue<N>;
  /** Stable; writes with origin "user". */
  onChange: (value: InferValue<N>) => void;
  error: string | undefined;
  touched: boolean;
  dirty: boolean;
  validating: boolean;
  /** Set on blur (onBlur) and by submit; cleared by reset. */
  revealed: boolean;
  /** Whether to show the error now, per the provided display policy. */
  showError: boolean;
  /** Stable; marks the field revealed. Pass it to the input's onBlur. */
  onBlur: () => void;
  /** Stable callback ref: registers the element (or any FocusTarget) for focusing errors. */
  focusRef: (target: FocusTarget | null) => void;
  store: BaseStore<any>;
}

/** A node with control(): value, onChange and the control state. */
export function useControl<N extends ControlNode>(node: N, options?: HookOptions): ControlBinding<N> {
  const store = useResolved(node, options);
  const value = useValue(node, { store }) as InferValue<N>;
  const meta = useOwnMeta(store, node) as InferMeta<ControlNode>;
  const onChange = useSetter(store, node);

  const registered = useRef<FocusTarget | null>(null);
  const focusRef = useCallback(
    (target: FocusTarget | null) => {
      if (target) {
        registered.current = target;
        store.setMeta(node, { focusTarget: target } as never);
        return;
      }
      // Unmount: clear only what this ref registered (another element may have taken over).
      if (registered.current && store.focusTargetOf(node) === registered.current) {
        store.setMeta(node, { focusTarget: undefined } as never);
      }
      registered.current = null;
    },
    [store, node]
  );

  const onBlur = useCallback(() => {
    // A row being removed may blur its focused input after detaching.
    if (store.isAttached()) store.setMeta(node, { revealed: true } as never, { origin: "user" });
  }, [store, node]);

  const policy = useContext(ErrorDisplayContext);
  const showError = policy(meta);

  return {
    value,
    onChange,
    error: meta.error,
    touched: meta.touched,
    dirty: meta.dirty,
    validating: meta.validating,
    revealed: meta.revealed,
    showError,
    onBlur,
    focusRef,
    store,
  };
}

// ============================================================
// Native adapters
// ============================================================
const inputHandlers = new WeakMap<Function, Function>();
const checkboxHandlers = new WeakMap<Function, Function>();

/**
 * Adapt an onChange for strings to an input / textarea / select change
 * handler. The same onChange always gets the same handler (no hook needed).
 */
export function fromInput(onChange: (value: string) => void): (event: { target: { value: string } }) => void {
  let handler = inputHandlers.get(onChange);
  if (!handler) {
    handler = (event: { target: { value: string } }) => onChange(event.target.value);
    inputHandlers.set(onChange, handler);
  }
  return handler as (event: { target: { value: string } }) => void;
}

/** Adapt an onChange for booleans to a checkbox change handler. */
export function fromCheckbox(onChange: (checked: boolean) => void): (event: { target: { checked: boolean } }) => void {
  let handler = checkboxHandlers.get(onChange);
  if (!handler) {
    handler = (event: { target: { checked: boolean } }) => onChange(event.target.checked);
    checkboxHandlers.set(onChange, handler);
  }
  return handler as (event: { target: { checked: boolean } }) => void;
}

// ============================================================
// useArray
// ============================================================
type RowOf<N extends ArrayNode<any, any>> = ItemStore<N["item"]>;

export interface ArrayBinding<N extends ArrayNode<any, any>> {
  /** Row stores in order; the same array until rows are added, removed or reordered. */
  items: readonly RowOf<N>[];
  /** The helpers write with origin "user" unless options say otherwise. */
  append: (...args: NewItemArgs<N>) => RowOf<N>;
  insert: (index: number, ...args: NewItemArgs<N>) => RowOf<N>;
  remove: (row: RowOf<N>, options?: WriteOptions) => void;
  move: (row: RowOf<N>, toIndex: number, options?: WriteOptions) => void;
  store: ArrayStore<N>;
}

const USER: WriteOptions = { origin: "user" };

/** Rows of an array node; re-renders only when the sequence of rows changes. */
export function useArray<N extends ArrayNode<any, any>>(node: N, options?: HookOptions): ArrayBinding<N> {
  const host = useResolved(node, options);
  const store = useMemo(() => host.substore(node) as ArrayStore<N>, [host, node]);
  const items = useSyncExternalStore(store.subscribeItems, store.items, store.items);
  const helpers = useMemo(() => {
    const withUser = (args: unknown[], at: number) => {
      const out = [...args];
      if (out[at] === undefined) out[at] = USER;
      return out;
    };
    return {
      append: (...args: any[]) => (store.append as any)(...withUser(args, 1)),
      insert: (index: number, ...args: any[]) => (store.insert as any)(index, ...withUser(args, 1)),
      remove: (row: RowOf<N>, opts?: WriteOptions) => store.remove(row, opts ?? USER),
      move: (row: RowOf<N>, to: number, opts?: WriteOptions) => store.move(row, to, opts ?? USER),
    };
  }, [store]);
  return { items: items as readonly RowOf<N>[], ...helpers, store } as ArrayBinding<N>;
}
