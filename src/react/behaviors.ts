// ============================================================
// useBehaviors – behaviors and rules defined in components
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
//   • Latest props: run / check / guard functions always call the most recent
//     build, without re-registering. Only the functions are refreshed: put
//     everything the result depends on in deps (a refreshed function runs the
//     next time a trigger changes, not immediately). If the declarations
//     themselves change without a deps change, the old registration stays and
//     a dev warning is logged.
//   • { key }: components registering the same behaviors (e.g. the same
//     component rendered twice) share one registration, reference-counted.
//     All holders of a key must register the same behaviors.
//   • StrictMode safe: the simulated unmount disposes, the remount registers again.
// ============================================================

import { useLayoutEffect, useRef } from "react";
import { Behavior, type AnyBehavior, type BehaviorHandle, type Guard } from "../behaviors";
import { defineBehaviors, type BehaviorBuilder } from "../builder";
import { Rule } from "../validation";
import { refKey } from "../internal";
import type { BaseStore } from "../store";
import { useStore, type HookOptions } from "./hooks";

const isDev = () => (globalThis as any).process?.env?.NODE_ENV !== "production";

export interface UseBehaviorsOptions extends HookOptions {
  /** Share one registration among components using the same key on the same store. */
  key?: string;
}

interface Slot {
  current: AnyBehavior;
}

interface Registration {
  handle: BehaviorHandle;
  signature: string;
  slots: Slot[];
}

interface Shared extends Registration {
  count: number;
}

const sharedByHost = new WeakMap<BaseStore<any>, Map<string, Shared>>();

function asArray<T>(v: T | readonly T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? [...(v as readonly T[])] : [v as T];
}

function guardsOf(item: AnyBehavior): Guard[] {
  return item instanceof Rule ? asArray(item.options.when) : asArray((item as Behavior).config.when);
}

/** What was declared (not the functions): if it changes, the registration must change. */
function signature(list: readonly AnyBehavior[]): string {
  const keys = (refs: readonly any[] | undefined) => (refs ?? []).map(refKey).join(",");
  const guards = (item: AnyBehavior) => guardsOf(item).map((g) => keys(g.refs)).join(";");
  return list
    .map((item) => {
      if (item instanceof Rule) {
        const o = item.options;
        return ["R", item.kind, refKey(item.target), keys(o.triggers), keys(o.reads), guards(item), o.debounce ?? "", o.origins ?? "", o.name ?? ""].join("|");
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
  if (item instanceof Rule) {
    return new Rule(item.target, item.kind, ((value: any, ctx: any) => (slot.current as Rule).check(value, ctx)) as any, {
      ...item.options,
      when: guards,
    });
  }
  if (item instanceof Behavior) {
    return new Behavior(
      { ...item.config, when: guards, run: (ctx) => (slot.current as Behavior).config.run(ctx) },
      { branches: item._branches, trace: item._trace }
    );
  }
  throw new Error("useBehaviors: expected behaviors and rules");
}

function prepare(host: BaseStore<any>, build: (b: BehaviorBuilder) => void) {
  const list = defineBehaviors(host.root.node, (b) => build(b));
  const slots = list.map((current) => ({ current }));
  return { signature: signature(list), slots, wrapped: list.map((item, i) => delegate(item, slots[i])) };
}

function withHint(error: unknown): unknown {
  if (error instanceof Error && /already written by/.test(error.message)) {
    return new Error(
      `${error.message} – if this component is rendered more than once, pass { key } to useBehaviors to share one registration`,
      { cause: error }
    );
  }
  return error;
}

/**
 * Register behaviors and rules from a component. `build` uses the same
 * builder as defineBehaviors; `deps` re-register (atomically) when they change.
 */
export function useBehaviors(build: (b: BehaviorBuilder) => void, deps: readonly unknown[], options: UseBehaviorsOptions = {}): void {
  const host = useStore(options)._host;
  const key = options.key;
  const current = useRef<{ host: BaseStore<any>; registration: Registration } | null>(null);
  const warned = useRef(false);

  // 1. Lifetime: dispose on unmount and when the store (or key) changes.
  useLayoutEffect(() => {
    return () => {
      const held = current.current;
      current.current = null;
      if (!held) return;
      if (key === undefined) {
        held.registration.handle();
        return;
      }
      const byKey = sharedByHost.get(held.host);
      const shared = byKey?.get(key);
      if (shared && --shared.count === 0) {
        byKey!.delete(key);
        shared.handle();
      }
    };
  }, [host, key]);

  // 2. Register, or replace atomically when deps change.
  useLayoutEffect(() => {
    const next = prepare(host, build);
    try {
      if (!current.current) {
        if (key === undefined) {
          const registration = { handle: host.addBehavior(next.wrapped), signature: next.signature, slots: next.slots };
          current.current = { host, registration };
          return;
        }
        let byKey = sharedByHost.get(host);
        if (!byKey) sharedByHost.set(host, (byKey = new Map()));
        let shared = byKey.get(key);
        if (shared) {
          shared.count++;
        } else {
          shared = { handle: host.addBehavior(next.wrapped), signature: next.signature, slots: next.slots, count: 1 };
          byKey.set(key, shared);
        }
        current.current = { host, registration: shared };
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
  }, [host, key, ...deps]);

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
