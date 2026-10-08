// Async behaviors: a run may return a promise. Cancellation, reruns with
// cause inheritance, transactional ctx.state, kept work, settle().

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  form,
  object,
  array,
  field,
  createStore,
  defineBehavior,
  when,
  type InferValue,
  type StoreOptions,
  type AnyRef,
  type AnyNode,
  type OriginKind,
} from "../src/index";
import { deferred, flush } from "./support/harness";

const shape = form(
  object({
    code: field<string>(),
    name: field<string>(),
    region: field<string>(),
    rows: array(object({ sku: field<string>(), title: field<string>() })),
  }),
);
type Values = InferValue<typeof shape>;
const R = shape.rows.item;
const initial = (): Values => ({ code: "a", name: "", region: "", rows: [{ sku: "x", title: "" }] });

/** Sleeps like a debounce: rejects with the signal's reason when it is aborted. */
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

function errors() {
  const list: unknown[] = [];
  const onError: StoreOptions["onError"] = (error) => list.push(error);
  return { list, onError };
}

describe("Async runs", () => {
  test("an async run's writes apply when its promise resolves, not before", async () => {
    const s = createStore(shape, initial());
    const lookup = deferred<string>();
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => ctx.set(shape.name, await lookup.promise),
      }),
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
          await Promise.resolve();
          seen.push(ctx.get(shape.name));
          ctx.set(shape.name, "last");
        },
      }),
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
          await Promise.resolve();
          throw failure;
        },
      }),
      defineBehavior({
        name: "undeclared",
        triggers: [shape.code],
        writes: [shape.rows],
        run: async (ctx) => {
          ctx.set(shape.rows, []);
          await Promise.resolve();
          ctx.get(shape.name);
        },
      }),
    ]);
    await flush();
    expect((list[0] as Error).cause).toBe(failure);
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
          await Promise.resolve();
          const row = { sku: "y", title: "" };
          ctx.set(shape.rows, [row, row]);
        },
      }),
    );
    await flush();
    expect(String(list[0])).toMatch(/same object twice/);
  });
});

describe("Cancellation", () => {
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
      }),
    );
    s.set(shape.code, "b", { origin: "user" });
    expect(calls.map((c) => [c.code, c.signal.aborted])).toEqual([
      ["a", true],
      ["b", false],
    ]);

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
      }),
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
      }),
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
      }),
    );
    s.set(shape.name, "n1");
    expect(calls.map((c) => [c.name, c.signal.aborted])).toEqual([
      ["", true],
      ["n1", false],
    ]);

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
      }),
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
      }),
    );
    calls[0].done.resolve();
    await flush();
    s.set(shape.code, "b");
    s.set(shape.rows, []);
    calls[1].done.resolve();
    await flush();
    expect(calls.map((c) => [c.code, c.signal.aborted])).toEqual([
      ["a", false],
      ["b", true],
    ]);
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
      }),
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
      }),
    );
    dispose();
    gate.resolve();
    await flush();
    expect(signals.map((x) => x.aborted)).toEqual([true]);
    expect(s.get(shape.name)).toBe("");
  });

  test("reset() covering a run cancels it; the init rerun has no cause from it", async () => {
    const s = createStore(shape, initial());
    const runs: { origins: string[]; signal: AbortSignal }[] = [];
    const gate = deferred<void>();
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        run: async (ctx) => {
          runs.push({ origins: [...ctx.origins], signal: ctx.signal });
          await gate.promise;
          ctx.set(shape.name, ctx.get(shape.code));
        },
      }),
    );
    s.set(shape.code, "b", { origin: "user" });
    s.reset(shape.name); // the name is still "": the reset writes nothing new
    gate.resolve();
    await flush();
    expect(runs.map((r) => [r.origins, r.signal.aborted])).toEqual([
      [[], true],
      [["user"], true], // replaced the init run in flight
      [[], false],
    ]);
    expect(s.get(shape.name)).toBe("b");
  });
});

describe("Reruns", () => {
  /** An async behavior that records each run's cause and waits for a gate. */
  function recorder(config: {
    triggers: AnyRef[];
    reads?: AnyRef[];
    origins?: OriginKind[];
    runOn?: { init?: boolean };
  }) {
    const runs: { origins: string[]; changed: string[]; signal: AbortSignal }[] = [];
    const gate = deferred<void>();
    const behavior = defineBehavior({
      ...config,
      writes: [shape.rows],
      run: async (ctx) => {
        runs.push({
          origins: [...ctx.origins].map((o) => o.replace(/^behavior:.*/, "behavior")),
          changed: [...config.triggers, ...(config.reads ?? [])]
            .filter((t) => ctx.changed(t))
            .map((t) => (t as AnyNode).path),
          signal: ctx.signal,
        });
        await gate.promise;
      },
    });
    return { runs, gate, behavior };
  }

  test("a user run cancelled by a behavior's trigger change is rerun with the user's cause too", () => {
    const s = createStore(shape, initial());
    const { runs, behavior } = recorder({ triggers: [shape.code, shape.name], runOn: { init: false } });
    s.addBehavior([
      behavior,
      defineBehavior({
        triggers: [shape.region],
        writes: [shape.name],
        runOn: { init: false },
        run: (ctx) => ctx.set(shape.name, ctx.get(shape.region).toUpperCase()),
      }),
    ]);
    s.set(shape.code, "b", { origin: "user" });
    s.set(shape.region, "eu");
    expect(runs.map((r) => [r.origins, r.changed, r.signal.aborted])).toEqual([
      [["user"], ["code"], true],
      [["user", "behavior"], ["code", "name"], false],
    ]);
  });

  test("a change the origins filter ignores cancels and reruns with only the cancelled run's cause", () => {
    const s = createStore(shape, initial());
    const { runs, behavior } = recorder({ triggers: [shape.code, shape.name], origins: ["user"] });
    s.addBehavior(behavior);
    s.set(shape.code, "b", { origin: "user" });
    s.set(shape.name, "n"); // "program": filtered out
    expect(runs.map((r) => [r.origins, r.changed, r.signal.aborted])).toEqual([
      [[], [], true],
      [["user"], ["code"], true],
      [["user"], ["code"], false],
    ]);
  });

  test("a reads change rerun takes the change's cause, minus what the origins filter ignores", () => {
    const s = createStore(shape, initial());
    const { runs, behavior } = recorder({
      triggers: [shape.code],
      reads: [shape.name, shape.region],
      origins: ["user"],
      runOn: { init: false },
    });
    s.addBehavior(behavior);
    s.set(shape.code, "b", { origin: "user" });
    s.set(shape.name, "n"); // "program": filtered out
    s.set(shape.region, "eu", { origin: "user" });
    expect(runs.map((r) => [r.origins, r.changed])).toEqual([
      [["user"], ["code"]],
      [["user"], ["code"]],
      [["user"], ["code", "region"]],
    ]);
    s.set(shape.code, "c", { origin: "program" });
    expect(runs).toHaveLength(4); // rerun, though the origins filter ignores the change
  });

  test("a reads change reruns a run in flight, and starts none when idle", async () => {
    const s = createStore(shape, initial());
    const { runs, gate, behavior } = recorder({ triggers: [], reads: [shape.code] });
    s.addBehavior(behavior);
    s.set(shape.code, "b", { origin: "user" });
    expect(runs.map((r) => [r.origins, r.changed, r.signal.aborted])).toEqual([
      [[], [], true],
      [["user"], ["code"], false], // replaced the init run in flight
    ]);
    gate.resolve();
    await flush();
    s.set(shape.code, "c", { origin: "user" });
    expect(runs).toHaveLength(2);
  });
});

describe("Transactional state", () => {
  test("ctx.state changed in place by a cancelled run is not saved; a completed run's is", async () => {
    const s = createStore(shape, initial());
    const seen: unknown[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        runOn: { init: false },
        run: async (ctx) => {
          seen.push(ctx.state.overridden);
          if (ctx.origins.has("user")) ctx.state.overridden = true; // in place, like calculate
          await Promise.resolve();
        },
      }),
    );
    s.set(shape.code, "b", { origin: "user" });
    s.set(shape.name, "typed"); // another origin writes the target: cancelled, no rerun
    s.set(shape.code, "c");
    await flush();
    s.set(shape.code, "d", { origin: "user" });
    await flush();
    s.set(shape.code, "e");
    expect(seen).toEqual([undefined, undefined, undefined, true]);
  });
});

describe("settle()", () => {
  afterEach(() => void vi.useRealTimers());

  test("waits for the runs in flight that write inside the node, reruns included", async () => {
    vi.useFakeTimers();
    const s = createStore(shape, initial());
    s.addBehavior([
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.name],
        runOn: { init: false },
        run: async (ctx) => {
          await sleep(100, ctx.signal);
          ctx.set(shape.name, ctx.get(shape.code).toUpperCase());
        },
      }),
      defineBehavior({
        triggers: [shape.code],
        writes: [shape.region],
        runOn: { init: false },
        run: async (ctx) => {
          await sleep(1000, ctx.signal);
          ctx.set(shape.region, "eu");
        },
      }),
    ]);
    s.set(shape.code, "b");
    let named = false;
    const name = s.settle(shape.name).then(() => (named = true));
    await vi.advanceTimersByTimeAsync(50);
    s.set(shape.code, "c");
    await vi.advanceTimersByTimeAsync(99);
    expect(named).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await name;
    expect(s.get(shape.name)).toBe("C");
    expect(s.get(shape.region)).toBe("");

    const all = s.settle();
    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(s.get(shape.region)).toBe("eu");
  });

  test("does not wait for a removed row's run", async () => {
    vi.useFakeTimers();
    const s = createStore(shape, initial());
    s.addBehavior(
      defineBehavior({
        triggers: [R.sku],
        writes: [R.title],
        run: async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // ignores the signal
          ctx.set(R.title, "looked up");
        },
      }),
    );
    let settled = false;
    const done = s.settle().then(() => (settled = true));
    const rows = s.substore(shape.rows);
    rows.remove(rows.itemAt(0));
    await done;
    expect(settled).toBe(true);
  });

  test("a row behavior triggered by its whole array settles in one round: siblings' writes cancel nothing", async () => {
    vi.useFakeTimers();
    const rows = [
      { sku: "a", title: "" },
      { sku: "b", title: "" },
      { sku: "c", title: "" },
    ];
    const s = createStore(shape, { ...initial(), rows });
    const started: string[] = [];
    const aborted: string[] = [];
    s.addBehavior(
      defineBehavior({
        triggers: [shape.rows],
        reads: [R.sku],
        writes: [R.title],
        run: async (ctx) => {
          const sku = ctx.get(R.sku);
          started.push(sku);
          ctx.signal.addEventListener("abort", () => aborted.push(sku));
          const all = ctx.get(shape.rows);
          // Rows finish one after another: each commit changes the array while the later rows are in flight.
          await sleep(100 * (all.findIndex((r) => r.sku === sku) + 1), ctx.signal);
          ctx.set(R.title, `${sku} of ${all.length}`);
        },
      }),
    );
    let settled = false;
    const done = s.settle().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(300);
    expect(settled, "after one round").toBe(true);
    await done;
    expect(started).toEqual(["a", "b", "c"]);
    expect(aborted).toEqual([]);
    expect(s.get(shape.rows).map((r) => r.title)).toEqual(["a of 3", "b of 3", "c of 3"]);
  });
});

describe("Kept work", () => {
  /** Looks up the code's label in kept work keyed by the code; the region is label + name. */
  function lookup(scope: { code: AnyRef; out: AnyRef; name?: AnyRef }) {
    const starts: { key: string; signal: AbortSignal; result: ReturnType<typeof deferred<string>> }[] = [];
    const behavior = defineBehavior({
      triggers: [scope.code, ...(scope.name ? [scope.name] : [])],
      writes: [scope.out as any],
      run: async (ctx) => {
        const code = ctx.get(scope.code) as string;
        if (code === "") return;
        const label = await ctx.keep([code], (signal) => {
          const start = { key: code, signal, result: deferred<string>() };
          starts.push(start);
          return start.result.promise;
        });
        ctx.set(scope.out as any, label + (scope.name ? ctx.get(scope.name) : ""));
      },
    });
    return { starts, behavior };
  }

  test("a trigger change outside the key keeps the work", async () => {
    const s = createStore(shape, initial());
    const { starts, behavior } = lookup({ code: shape.code, name: shape.name, out: shape.region });
    s.addBehavior(behavior);
    s.set(shape.name, "-n");
    expect(starts.map((x) => [x.key, x.signal.aborted])).toEqual([["a", false]]);
    starts[0].result.resolve("A");
    await s.settle();
    expect(s.get(shape.region)).toBe("A-n");
  });

  test("a key change aborts the work and starts new work", async () => {
    const s = createStore(shape, initial());
    const { starts, behavior } = lookup({ code: shape.code, out: shape.region });
    s.addBehavior(behavior);
    s.set(shape.code, "b");
    expect(starts.map((x) => [x.key, x.signal.aborted])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    starts[1].result.resolve("B");
    await s.settle();
    expect(s.get(shape.region)).toBe("B");
  });

  test("the work is aborted at the end of the flush when the rerun doesn't keep it", () => {
    const s = createStore(shape, initial());
    const { starts, behavior } = lookup({ code: shape.code, out: shape.region });
    s.addBehavior(behavior);
    s.set(shape.code, ""); // the rerun returns before calling keep
    expect(starts.map((x) => [x.key, x.signal.aborted])).toEqual([["a", true]]);
  });

  test("row removal, dispose and reset() abort the work", () => {
    const s = createStore(shape, initial());
    const row = lookup({ code: R.sku, out: R.title });
    const root = lookup({ code: shape.code, out: shape.region });
    s.addBehavior(row.behavior);
    const dispose = s.addBehavior(root.behavior);

    const rows = s.substore(shape.rows);
    rows.remove(rows.itemAt(0));
    expect(row.starts.map((x) => x.signal.aborted)).toEqual([true]);

    s.reset(shape.region); // the init rerun keeps an equal key, but gets new work
    expect(root.starts.map((x) => [x.key, x.signal.aborted])).toEqual([
      ["a", true],
      ["a", false],
    ]);

    dispose();
    expect(root.starts.map((x) => x.signal.aborted)).toEqual([true, true]);
  });

  test("row removal and dispose abort work whose holder run has already ended", () => {
    const s = createStore(shape, initial());
    const signals: AbortSignal[] = [];
    /** Keeps work without awaiting it: the run ends while the work is in flight. */
    const prefetch = (code: AnyRef) =>
      defineBehavior({
        triggers: [code],
        run: (ctx) => {
          void ctx.keep([ctx.get(code)], (signal) => {
            signals.push(signal);
            return deferred<void>().promise;
          });
        },
      });
    s.addBehavior(prefetch(R.sku));
    const dispose = s.addBehavior(prefetch(shape.code));
    expect(signals.map((x) => x.aborted)).toEqual([false, false]);

    const rows = s.substore(shape.rows);
    rows.remove(rows.itemAt(0));
    expect(signals.map((x) => x.aborted)).toEqual([true, false]);

    dispose();
    expect(signals.map((x) => x.aborted)).toEqual([true, true]);
  });
});

describe("Definition traces", () => {
  const failing = () =>
    defineBehavior({
      triggers: [shape.code],
      writes: [shape.name],
      run: async () => {
        await Promise.resolve();
        throw new TypeError("lookup failed");
      },
    });

  test("in dev, onError gets an error located where the behavior was defined, with the thrown error as cause", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    s.addBehavior(failing());
    await s.settle();
    const error = list[0] as Error;
    expect(error.message).toBe("lookup failed");
    expect((error.cause as Error).message).toBe("lookup failed");
    expect(error.cause).toBeInstanceOf(TypeError);
    const frame = error.stack!.split("\n").find((l) => l.trim().startsWith("at "));
    expect(frame).toMatch(/async\.test\.ts/); // the call to defineBehavior in `failing`
  });

  test("in production, onError gets the thrown value itself", async () => {
    const { list, onError } = errors();
    const s = createStore(shape, initial(), { onError });
    vi.stubEnv("NODE_ENV", "production");
    try {
      s.addBehavior(failing());
    } finally {
      vi.unstubAllEnvs();
    }
    await s.settle();
    expect(list[0]).toBeInstanceOf(TypeError);
  });
});
