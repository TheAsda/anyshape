// ============================================================
// Submit – handleSubmit(store, fn) for a store whose own node declares
// submission(): the form root, or a section or row that declares it itself.
// ------------------------------------------------------------
//   1. One submit at a time per store: a call while one runs resolves at once.
//   2. One batch: `submitting` on, and `revealed` on every node of the
//      subtree that declares reveal().
//   3. Validate the subtree, waiting for async checks.
//   4. Valid: fn(formData), the store's value as it is. Invalid: focus the
//      first error in document order.
//   5. `submitting` off. If fn throws, the handler's promise rejects.
// ============================================================

import { metaKey, type MetaRef, type AnyNode, type BaseStore, type ContainerNode, type InferValue } from "form-lib";
import { focusFirst } from "./focus";

/** true while a submit of the node is running. */
export const submitting = metaKey(false, { owner: "feature" });

/** Makes a node submittable: handleSubmit accepts a store whose own node declares it. */
export const submission = () => ({ submitting });

/** true once the field's error may be shown: set on blur by the bindings and by a submit. Cleared by reset(). */
export const revealed = metaKey(false, { owner: "feature" });

export const reveal = () => ({ revealed });

/** A node that declares submission(). */
export type Submittable = ContainerNode & { readonly submitting: MetaRef<boolean> };

/** A <form onSubmit> handler; call it with no event for a programmatic submit. */
export type FormSubmitHandler = (event?: { preventDefault?(): void }) => Promise<void>;

/** Stores with a submit running: one submit at a time per submittable node instance. */
const running = new WeakSet<BaseStore<any>>();

export function handleSubmit<N extends Submittable>(
  store: BaseStore<N>,
  fn: (formData: InferValue<N>) => void | Promise<void>
): FormSubmitHandler {
  // Only a node that declares submission() itself is submitted: its own
  // `submitting`, matched by definition (the types can't tell definitions apart).
  const own = store.collect(store.node, submitting).find((e) => e.ref.node === store.node);
  if (!own) throw new Error(`handleSubmit: "${store.node.path || "<root>"}" does not declare submission()`);
  return async (event) => {
    event?.preventDefault?.();
    if (running.has(store)) return;
    running.add(store);
    store.batch(() => {
      store.set(own.ref, true);
      for (const e of store.collect(store.node, revealed)) e.store.set(e.ref, true);
    });
    try {
      // The store's validate() until #26 replaces it with the validation recipe's validate(store).
      const { valid, errors } = await store.validate();
      if (valid) await fn(store.get(store.node as AnyNode) as InferValue<N>);
      else focusFirst(errors);
    } finally {
      running.delete(store);
      store.set(own.ref, false);
    }
  };
}
