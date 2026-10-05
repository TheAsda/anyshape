// ============================================================
// useBehaviors – behaviors and contributions defined in components
// ------------------------------------------------------------
//   useBehaviors((b) => {
//     if (strict) b.add(pattern(shape.phone, E164));   // props: plain if + deps
//     else b.add(pattern(shape.phone, LOOSE));
//     b.when([shape.type], (t) => t === "company", (b) => b.add(required(shape.vat)));  // form values: b.when
//   }, [strict]);
//
//   • Same builder as defineBehaviors. Registered on the provided store's
//     scope: under a row provider, for that row only.
//   • Registered in a layout effect (before paint), removed on unmount.
//   • deps change → the registration is replaced atomically (no flicker).
//   • Latest props: run and guard functions and contribution payloads
//     always come from the most recent build, without re-registering. Only
//     those are refreshed: put
//     everything the result depends on in deps (a refreshed function runs the
//     next time a trigger changes, not immediately). If the declarations
//     themselves change without a deps change, the old registration stays and
//     a dev warning is logged.
//   • A component rendered twice registers twice: a behavior it declares
//     then has two writers. Declare such behaviors once, in createStore or a
//     common parent. Contributions never conflict: each copy is one more part.
//   • StrictMode safe: the simulated unmount disposes, the remount registers again.
// ============================================================

import { useLayoutEffect, useRef } from "react";
import { Behavior, Contribution, type AnyBehavior, type BehaviorHandle, type Guard } from "../behaviors";
import { defineBehaviors, type BehaviorBuilder } from "../builder";
import { refKey, isDev } from "../internal";
import type { BaseStore } from "../store";
import { useStore, type HookOptions } from "./hooks";

export type UseBehaviorsOptions = HookOptions;

interface Slot {
  current: AnyBehavior;
}

interface Registration {
  handle: BehaviorHandle;
  signature: string;
  slots: Slot[];
}

function asArray<T>(v: T | readonly T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? [...(v as readonly T[])] : [v as T];
}

function guardsOf(item: AnyBehavior): Guard[] {
  return item instanceof Contribution ? asArray(item.decl.when) : asArray(item.config.when);
}

/** What was declared (not the functions): if it changes, the registration must change. */
function signature(list: readonly AnyBehavior[]): string {
  const keys = (refs: readonly any[] | undefined) => (refs ?? []).map(refKey).join(",");
  const guards = (item: AnyBehavior) => guardsOf(item).map((g) => keys(g.refs)).join(";");
  return list
    .map((item) => {
      if (item instanceof Contribution) {
        const d = item.decl;
        return ["C", refKey(item.target), keys(d.triggers), keys(d.reads), guards(item), d.name ?? ""].join("|");
      }
      const c = (item as Behavior).config;
      return ["B", keys(c.triggers), keys(c.reads), keys(c.writes), JSON.stringify(c.runOn ?? {}), (c.origins ?? []).join(","), guards(item), c.name ?? ""].join("|");
    })
    .join("\n");
}

/** A registered copy of `item` whose functions call the item currently in `slot`. */
function delegate(item: AnyBehavior, slot: Slot): AnyBehavior {
  const guards = guardsOf(item).map((g, j) => ({
    refs: g.refs,
    test: (...values: any[]) => guardsOf(slot.current)[j].test(...values),
  }));
  if (item instanceof Contribution) {
    // The core reads `payload` on every run, so a getter gives the latest
    // props without the core knowing what is inside it.
    const copy = new Contribution(item.target, item.payload, { ...item.decl, when: guards });
    Object.defineProperty(copy, "payload", { get: () => (slot.current as Contribution).payload });
    return copy;
  }
  if (item instanceof Behavior) {
    return new Behavior(
      { ...item.config, when: guards, run: (ctx) => (slot.current as Behavior).config.run(ctx) },
      { trace: item._trace }
    );
  }
  throw new Error("useBehaviors: expected behaviors and contributions");
}

function prepare(host: BaseStore<any>, build: (b: BehaviorBuilder) => void) {
  const list = defineBehaviors(host.root.node, (b) => build(b));
  const slots = list.map((current) => ({ current }));
  return { signature: signature(list), slots, wrapped: list.map((item, i) => delegate(item, slots[i])) };
}

function withHint(error: unknown): unknown {
  if (error instanceof Error && /already written by/.test(error.message)) {
    return new Error(
      `${error.message} – if this component is rendered more than once, declare it once, in createStore or a common parent`,
      { cause: error }
    );
  }
  return error;
}

/**
 * Register behaviors and contributions from a component. `build` uses the same
 * builder as defineBehaviors; `deps` re-register (atomically) when they change.
 */
export function useBehaviors(build: (b: BehaviorBuilder) => void, deps: readonly unknown[], options: UseBehaviorsOptions = {}): void {
  const host = useStore(options).scopeStore;
  const current = useRef<{ host: BaseStore<any>; registration: Registration } | null>(null);
  const warned = useRef(false);

  // 1. Lifetime: dispose on unmount and when the store changes.
  useLayoutEffect(() => {
    return () => {
      current.current?.registration.handle();
      current.current = null;
    };
  }, [host]);

  // 2. Register, or replace atomically when deps change.
  useLayoutEffect(() => {
    const next = prepare(host, build);
    try {
      if (!current.current) {
        const registration = { handle: host.addBehavior(next.wrapped), signature: next.signature, slots: next.slots };
        current.current = { host, registration };
        return;
      }
      const registration = current.current.registration;
      registration.handle = host.replaceBehavior(registration.handle, next.wrapped);
      registration.signature = next.signature;
      registration.slots = next.slots;
      warned.current = false;
    } catch (error) {
      throw withHint(error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, ...deps]);

  // 3. Latest props: point the registered functions at this render's build.
  useLayoutEffect(() => {
    const held = current.current;
    if (!held) return;
    const next = prepare(held.host, build);
    const registration = held.registration;
    if (next.signature !== registration.signature) {
      if (isDev() && !warned.current) {
        warned.current = true;
        console.warn(
          "useBehaviors: the declared behaviors changed without a deps change – keeping the registered ones. " +
            "Add the values that decide which behaviors are declared to deps."
        );
      }
      return;
    }
    next.slots.forEach((slot, i) => (registration.slots[i].current = slot.current));
  });
}
