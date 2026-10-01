// Pending: pendingIn(node, def?) / pendingOf(target), on the tally channel.

import { form, object, array, field, metaKey, createStore, defineBehavior, when, pendingIn, pendingOf } from "./index";
import { describe, expect, test } from "vitest";
import { deferred, flush } from "./test/harness";

const checked = metaKey(false);
const flagged = metaKey(false);

const shape = form({
  a: field<string>().meta({ checked }),
  b: field<string>().meta({ checked, flagged }),
  rows: array(object({ qty: field<number>().meta({ ok: checked }) })),
});
const R = shape.rows.item;
const initial = () => ({ a: "", b: "", rows: [{ qty: 1 }, { qty: 2 }] });

describe("Pending", () => {
  test("nothing is pending at rest; the refs are read-only and cached", () => {
    const s = createStore(shape, initial());
    expect(s.get(pendingIn(shape))).toBe(0);
    expect(s.get(pendingIn(shape, checked))).toBe(0);
    expect(s.get(pendingOf(shape.a.checked))).toBe(false);
    expect(s.get(pendingOf(shape.a))).toBe(false);

    expect(pendingIn(shape, checked)).toBe(pendingIn(shape, checked));
    expect(pendingIn(shape)).not.toBe(pendingIn(shape, checked));
    expect(pendingOf(shape.a.checked)).toBe(pendingOf(shape.a.checked));

    expect(() => s.set(pendingIn(shape) as any, 1 as never)).toThrow(/read-only/);
    expect(() => s.set(pendingOf(shape.a.checked) as any, true as never)).toThrow(/read-only/);
  });

  test("a run's write targets are pending while it runs, in its own row only", () => {
    const s = createStore(shape, initial());
    const seen: unknown[][] = [];
    s.addBehavior(
      defineBehavior({
        name: "check qty",
        triggers: [R.qty],
        reads: [pendingIn(shape), pendingIn(shape, checked), pendingIn(shape, flagged), pendingIn(R, checked), pendingOf(R.qty.ok), pendingOf(R.qty)],
        writes: [R.qty.ok],
        run: (ctx) => {
          seen.push([
            ctx.get(pendingIn(shape)),
            ctx.get(pendingIn(shape, checked)),
            ctx.get(pendingIn(shape, flagged)),
            ctx.get(pendingIn(R, checked)),
            ctx.get(pendingOf(R.qty.ok)),
            ctx.get(pendingOf(R.qty)),
          ]);
        },
      })
    );
    // One instance per row; only the running row is in flight.
    expect(seen).toEqual([
      [1, 1, 0, 1, true, false],
      [1, 1, 0, 1, true, false],
    ]);
    expect(s.get(pendingIn(shape))).toBe(0);
    expect(s.substore(shape.rows).itemAt(0).get(pendingOf(R.qty.ok))).toBe(false);
  });

  test("sync runs end within the flush, so pending never notifies", () => {
    const s = createStore(shape, initial());
    const row = s.substore(shape.rows).itemAt(1);
    s.addBehavior(defineBehavior({ triggers: [R.qty], writes: [R.qty.ok], run: (ctx) => ctx.set(R.qty.ok, ctx.get(R.qty) > 2) }));

    const fired: string[] = [];
    s.subscribe(pendingIn(shape, checked), () => fired.push("subscribe pendingIn"));
    s.react(pendingIn(shape), () => fired.push("react pendingIn"));
    row.subscribe(pendingOf(R.qty.ok), () => fired.push("subscribe pendingOf"));
    s.addBehavior(
      defineBehavior({
        triggers: [pendingIn(shape)],
        when: when([pendingOf(shape.a.checked)], (pending) => !pending),
        runOn: { init: false },
        run: () => void fired.push("behavior"),
      })
    );

    row.set(R.qty, 5);
    expect(row.get(R.qty.ok), "the run ran").toBe(true);
    expect(fired).toEqual([]);
  });
});

describe("Pending · async runs", () => {
  /** An async behavior writing `a.checked`, whose runs wait for their gates. */
  function checkA(s: ReturnType<typeof createStore<typeof shape>>) {
    const gates: ReturnType<typeof deferred<void>>[] = [];
    const dispose = s.addBehavior(
      defineBehavior({
        triggers: [shape.a],
        writes: [shape.a.checked],
        run: async (ctx) => {
          const gate = deferred<void>();
          gates.push(gate);
          await gate.promise;
          ctx.set(shape.a.checked, true);
        },
      })
    );
    return { gates, dispose };
  }

  test("subscriptions fire when an async run starts, and when it ends or is cancelled", async () => {
    const s = createStore(shape, initial());
    const seen: unknown[] = [];
    s.subscribe(pendingOf(shape.a.checked), () => seen.push(["of", s.get(pendingOf(shape.a.checked))]));
    s.subscribe(pendingIn(shape, checked), () => seen.push(["in", s.get(pendingIn(shape, checked))]));

    const { gates, dispose } = checkA(s);
    expect(seen.splice(0)).toEqual([["of", true], ["in", 1]]);

    gates[0].resolve();
    await flush();
    expect(seen.splice(0)).toEqual([["of", false], ["in", 0]]);

    s.set(shape.a, "x");
    s.set(shape.a, "y"); // cancelled and rerun: still pending
    expect(seen.splice(0)).toEqual([["of", true], ["in", 1]]);

    dispose();
    expect(seen.splice(0)).toEqual([["of", false], ["in", 0]]);
  });

  test("removing a row subtracts its pending targets", async () => {
    const s = createStore(shape, initial());
    const seen: number[] = [];
    s.subscribe(pendingIn(shape, checked), () => seen.push(s.get(pendingIn(shape, checked))));
    s.addBehavior(
      defineBehavior({
        triggers: [R.qty],
        writes: [R.qty.ok],
        run: async () => {
          await deferred<void>().promise;
        },
      })
    );
    const rows = s.substore(shape.rows);
    rows.remove(rows.itemAt(0));
    expect(s.get(pendingIn(shape, checked))).toBe(1);
    rows.remove(rows.itemAt(0));
    await flush();
    expect(seen).toEqual([2, 1, 0]);
  });

  test("a reader of pendingOf converges without a ranking edge from the key's writer", async () => {
    const s = createStore(shape, initial());
    const runs: boolean[] = [];
    // Registered first, so it runs before the writer and sees pending only once the tally changes.
    s.addBehavior(
      defineBehavior({
        triggers: [pendingOf(shape.a.checked)],
        writes: [shape.b.flagged],
        run: (ctx) => {
          runs.push(ctx.get(pendingOf(shape.a.checked)));
          ctx.set(shape.b.flagged, ctx.get(pendingOf(shape.a.checked)));
        },
      })
    );
    const { gates } = checkA(s);
    expect(s.get(shape.b.flagged)).toBe(true);
    gates[0].resolve();
    await flush();
    expect(s.get(shape.b.flagged)).toBe(false);
    expect(runs).toEqual([false, true, false]);
  });
});
