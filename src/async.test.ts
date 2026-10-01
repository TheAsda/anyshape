// Async behaviors: a run may return a promise. Cancellation, reruns with
// cause inheritance, transactional ctx.state, kept work, settle().

import { form, object, array, field, createStore, defineBehavior, when, type InferValue, type StoreOptions } from "./index";
import { describe, expect, test } from "vitest";
import { deferred, flush } from "./test/harness";

const shape = form({
  code: field<string>(),
  name: field<string>(),
  rows: array(object({ sku: field<string>(), title: field<string>() })),
});
type Values = InferValue<typeof shape>;
const R = shape.rows.item;
const initial = (): Values => ({ code: "a", name: "", rows: [{ sku: "x", title: "" }] });

function errors() {
  const list: unknown[] = [];
  const onError: StoreOptions["onError"] = (error) => list.push(error);
  return { list, onError };
}

describe("J · Async runs", () => {
  test("an async run's writes apply when its promise resolves, not before", async () => {
    const s = createStore(shape, initial());
    const lookup = deferred<string>();
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => ctx.set(shape.name, await lookup.promise),
      })
    );
    expect(s.get(shape.name)).toBe("");
    lookup.resolve("Alpha");
    await flush();
    expect(s.get(shape.name)).toBe("Alpha");
  });

  test("a run reads its own writes; the last write per target applies", async () => {
    const s = createStore(shape, initial());
    const seen: string[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          ctx.set(shape.name, "first");
          await null;
          seen.push(ctx.get(shape.name));
          ctx.set(shape.name, "last");
        },
      })
    );
    await flush();
    expect(seen).toEqual(["first"]);
    expect(s.get(shape.name)).toBe("last");
  });

  test("a rejected run or an undeclared access after await goes to onError, and its writes are dropped", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    const failure = new Error("lookup failed");
    s.addBehavior([
      defineBehavior({
        name: "rejects",
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          ctx.set(shape.name, "partial");
          await null;
          throw failure;
        },
      }),
      defineBehavior({
        name: "undeclared",
        triggers: [shape.code],
        writes: [shape.rows],
        run: async (ctx) => {
          ctx.set(shape.rows, []);
          await null;
          ctx.get(shape.name);
        },
      }),
    ]);
    await flush();
    expect(list[0]).toBe(failure);
    expect(String(list[1])).toMatch(/"name" is not declared/);
    expect(s.get(shape.name)).toBe("");
    expect(s.get(shape.rows)).toHaveLength(1);
  });

  test("a write that fails when the results apply goes to onError", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.rows],
        run: async (ctx) => {
          await null;
          const row = { sku: "y", title: "" };
          ctx.set(shape.rows, [row, row]);
        },
      })
    );
    await flush();
    expect(String(list[0])).toMatch(/same object twice/);
  });
});

describe("J · Cancellation", () => {
  test("a trigger change cancels the run in flight and reruns; the cancelled run's writes are dropped", async () => {
    const s = createStore(shape, initial());
    const calls: { code: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          const call = { code: ctx.get(shape.code), signal: ctx.signal, result: deferred<string>() };
          calls.push(call);
          ctx.set(shape.name, await call.result.promise);
        },
      })
    );
    s.set(shape.code, "b", { origin: "user" });
    expect(calls.map((c) => [c.code, c.signal.aborted])).toEqual([["a", true], ["b", false]]);

    calls[1].result.resolve("Beta");
    calls[0].result.resolve("Alpha"); // resolves last, but was cancelled
    await flush();
    expect(s.get(shape.name)).toBe("Beta");
  });

  test("after cancellation ctx.get and ctx.set throw, and nothing reaches onError", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    const gate = deferred<void>();
    const thrown: unknown[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          if (ctx.get(shape.code) !== "a") return;
          await gate.promise;
          for (const touch of [() => ctx.get(shape.code), () => ctx.set(shape.name, "late")]) {
            try {
              touch();
            } catch (e) {
              thrown.push(e);
            }
          }
          ctx.get(shape.code); // the rejection is ignored too
        },
      })
    );
    s.set(shape.code, "b");
    gate.resolve();
    await flush();
    expect(thrown).toHaveLength(2);
    expect(list).toEqual([]);
    expect(s.get(shape.name)).toBe("");
  });

  test("a cancelled run that returns without touching ctx again has its writes dropped", async () => {
    const s = createStore(shape, initial());
    const gate = deferred<void>();
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          if (ctx.get(shape.code) !== "a") return;
          ctx.set(shape.name, "stale");
          await gate.promise;
        },
      })
    );
    s.set(shape.code, "b");
    gate.resolve();
    await flush();
    expect(s.get(shape.name)).toBe("");
  });

  test("a reads change cancels and reruns a run in flight, but starts no run when idle", async () => {
    const s = createStore(shape, initial());
    const calls: { name: string; signal: AbortSignal; done: ReturnType<typeof deferred<void>> }[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        reads: [shape.name],
        writes: [shape.rows],
        run: async (ctx) => {
          const call = { name: ctx.get(shape.name), signal: ctx.signal, done: deferred<void>() };
          calls.push(call);
          await call.done.promise;
          ctx.set(shape.rows, [{ sku: call.name, title: "" }]);
        },
      })
    );
    s.set(shape.name, "n1");
    expect(calls.map((c) => [c.name, c.signal.aborted])).toEqual([["", true], ["n1", false]]);

    calls[1].done.resolve();
    await flush();
    expect(s.get(shape.rows)[0].sku).toBe("n1");
    s.set(shape.name, "n2");
    expect(calls).toHaveLength(2);
  });

  test("another origin writing a target cancels the run, with no rerun", async () => {
    const s = createStore(shape, initial());
    const calls: { signal: AbortSignal; done: ReturnType<typeof deferred<void>> }[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          const call = { signal: ctx.signal, done: deferred<void>() };
          calls.push(call);
          await call.done.promise;
          ctx.set(shape.name, "looked up");
        },
      })
    );
    s.set(shape.name, "typed", { origin: "user" });
    calls[0].done.resolve();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(true);
    expect(s.get(shape.name)).toBe("typed");
  });

  test("a guard turning false cancels the run; nothing reruns and earlier writes stay", async () => {
    const s = createStore(shape, initial());
    const calls: { code: string; signal: AbortSignal; done: ReturnType<typeof deferred<void>> }[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        when: when([shape.rows], (rows) => rows.length > 0),
        run: async (ctx) => {
          const call = { code: ctx.get(shape.code), signal: ctx.signal, done: deferred<void>() };
          calls.push(call);
          await call.done.promise;
          ctx.set(shape.name, `name of ${call.code}`);
        },
      })
    );
    calls[0].done.resolve();
    await flush();
    s.set(shape.code, "b");
    s.set(shape.rows, []);
    calls[1].done.resolve();
    await flush();
    expect(calls.map((c) => [c.code, c.signal.aborted])).toEqual([["a", false], ["b", true]]);
    expect(s.get(shape.name)).toBe("name of a");
  });

  test("removing a row cancels its run, even one that writes nothing", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    const signals: AbortSignal[] = [];
    const gate = deferred<void>();
    s.addBehavior(
      defineBehavior({
        triggers: [R.sku],
        run: async (ctx) => {
          signals.push(ctx.signal);
          await gate.promise;
          ctx.get(R.sku);
        },
      })
    );
    const rows = s.substore(shape.rows);
    rows.remove(rows.itemAt(0));
    expect(signals.map((x) => x.aborted)).toEqual([true]);
    gate.resolve();
    await flush();
    expect(list).toEqual([]);
  });

  test("disposing the behavior cancels its runs", async () => {
    const s = createStore(shape, initial());
    const signals: AbortSignal[] = [];
    const gate = deferred<void>();
    const dispose = s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          signals.push(ctx.signal);
          await gate.promise;
          ctx.set(shape.name, "looked up");
        },
      })
    );
    dispose();
    gate.resolve();
    await flush();
    expect(signals.map((x) => x.aborted)).toEqual([true]);
    expect(s.get(shape.name)).toBe("");
  });

  test("reset() covering a run cancels it; the init rerun has no cause from it", async () => {
    const s = createStore(shape, initial());
    const runs: { isInit: boolean; origins: string[]; signal: AbortSignal }[] = [];
    const gate = deferred<void>();
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          runs.push({ isInit: ctx.isInit, origins: [...ctx.origins], signal: ctx.signal });
          await gate.promise;
          ctx.set(shape.name, ctx.get(shape.code));
        },
      })
    );
    s.set(shape.code, "b", { origin: "user" });
    s.reset(shape.name); // the name is still "": the reset writes nothing new
    gate.resolve();
    await flush();
    expect(runs.map((r) => [r.isInit, r.origins, r.signal.aborted])).toEqual([
      [true, [], true],
      [false, ["user"], true],
      [true, [], false],
    ]);
    expect(s.get(shape.name)).toBe("b");
  });
});
