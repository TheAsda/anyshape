// Pending: pendingIn(node, def?) / pendingOf(target), on the tally channel.

import { form, object, array, field, metaKey, createStore, defineBehavior, pendingIn, pendingOf } from "./index";
import { describe, expect, test } from "vitest";

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
        run: (ctx) =>
          seen.push([
            ctx.get(pendingIn(shape)),
            ctx.get(pendingIn(shape, checked)),
            ctx.get(pendingIn(shape, flagged)),
            ctx.get(pendingIn(R, checked)),
            ctx.get(pendingOf(R.qty.ok)),
            ctx.get(pendingOf(R.qty)),
          ]),
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
      defineBehavior({ triggers: [pendingIn(shape)], runOn: { init: false }, run: () => void fired.push("behavior") })
    );

    row.set(R.qty, 5);
    expect(row.get(R.qty.ok), "the run ran").toBe(true);
    expect(fired).toEqual([]);
  });
});
