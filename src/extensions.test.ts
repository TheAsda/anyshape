import {
  form, object, array, field, createStore, countIn,
  control, validation, touched, visibility, disableable,
  type InferValue, type Origin, type FocusTarget,
} from "./index";
import { it, expect } from "vitest";

const shape = form(
  object({
    name: field<string>().meta(control()),
    email: field<string>().meta(control()),
    company: object({
      vat: field<string>().meta(validation(), visibility(), disableable()),
      address: object({ city: field<string>().meta(visibility(), disableable()) }).meta(visibility()),
    }).meta(visibility(), disableable()),
    lines: array(
      object({
        sku: field<string>().meta(control(), disableable()),
        qty: field<number>(),
        notes: array(object({ text: field<string>().meta(validation()) })),
      }).meta(touched()),
      { create: () => ({ sku: "", qty: 1, notes: [] }) }
    ).meta(disableable()),
    tags: array(object({ text: field<string>() })),
  }).meta(disableable())
);
type Values = InferValue<typeof shape>;
const L = shape.lines.item;

function initial(): Values {
  return {
    name: "Ann",
    email: "ann@x.io",
    company: { vat: "", address: { city: "Riga" } },
    lines: [
      { sku: "A", qty: 1, notes: [{ text: "a1" }] },
      { sku: "B", qty: 2, notes: [] },
    ],
    tags: [],
  };
}

// ---------------------------------------------------------------------------
// Reference API
it("get / set with value and meta refs", () => {
  const s = createStore(shape, initial());
  expect(s.get(shape.name)).toBe("Ann");
  s.set(shape.name, "Bob");
  expect(s.getValue(shape.name)).toBe("Bob");
  s.set(shape.name.error, "Bad");
  expect(s.get(shape.name.error)).toBe("Bad");
  expect(s.getMeta(shape.name).error).toBe("Bad");
});

it("subscribe to a single meta key ignores other keys", () => {
  const s = createStore(shape, initial());
  let calls = 0;
  s.subscribe(shape.name.error, () => calls++);
  s.set(shape.name.touched, true);
  expect(calls).toBe(0);
  s.set(shape.name.error, "x");
  expect(calls).toBe(1);
});

it("counts are read-only", () => {
  const s = createStore(shape, initial());
  expect(() => s.set(countIn(shape, "error") as any, 1 as never)).toThrow(/read-only/);
});

// ---------------------------------------------------------------------------
// Origins
function originsOf(fn: (record: (o: ReadonlySet<Origin>) => void) => void): Origin[][] {
  const seen: Origin[][] = [];
  fn((o) => seen.push([...o].sort()));
  return seen;
}

it("reactions receive the origin of the write", () => {
  const s = createStore(shape, initial());
  const seen = originsOf((rec) => s.react(shape.name, (_n, _p, info) => rec(info.origins)));
  s.set(shape.name, "U", { origin: "user" });
  s.set(shape.name, "P");
  s.set(shape.name, "I", { as: "initial" });
  expect(seen).toEqual([["user"], ["program"], ["initial"]]);
});

it("origins are tracked per target within one batch", () => {
  const s = createStore(shape, initial());
  const name: Origin[][] = [];
  const email: Origin[][] = [];
  s.react(shape.name, (_n, _p, i) => name.push([...i.origins]));
  s.react(shape.email, (_n, _p, i) => email.push([...i.origins]));
  s.batch(() => {
    s.set(shape.name, "U", { origin: "user" });
    s.set(shape.email, "p@x.io");
  });
  expect(name).toEqual([["user"]]);
  expect(email).toEqual([["program"]]);
});

it("origins cross scopes in both directions", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  const toRoot: Origin[][] = [];
  const toRow: Origin[][] = [];
  s.react(shape.lines, (_n, _p, i) => toRoot.push([...i.origins]));
  row.react(L.sku, (_n, _p, i) => toRow.push([...i.origins]));

  row.set(L.sku, "Z", { origin: "user" });              // row → enclosing array
  expect(toRoot).toEqual([["user"]]);
  expect(toRow).toEqual([["user"]]);

  const current = s.getValues().lines;
  s.set(shape.lines, [current[1]]);                      // array write detaches the row
  expect(toRow.at(-1)).toEqual(["program"]);
});

it("a write in one row is not an origin for another row", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  let bCalls = 0;
  b.react(L.sku, () => bCalls++);
  a.set(L.sku, "Z", { origin: "user" });
  expect(bCalls).toBe(0);
});

it("meta reactions receive origins", () => {
  const s = createStore(shape, initial());
  const seen: Origin[][] = [];
  s.react(shape.name.error, (_n, _p, i) => seen.push([...i.origins]));
  s.set(shape.name.error, "x", { origin: "behavior:required" });
  expect(seen).toEqual([["behavior:required"]]);
});

// ---------------------------------------------------------------------------
// Initial values
it("getInitial and { as: 'initial' }", () => {
  const s = createStore(shape, initial());
  s.set(shape.name, "Bob");
  expect(s.getInitial(shape.name)).toBe("Ann");
  s.set(shape.name, "Cid", { as: "initial" });
  expect(s.getInitial(shape.name)).toBe("Cid");
  expect(s.get(shape.name)).toBe("Cid");
});

it("rows keep their own initial value through edits and reordering", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  a.set(L.qty, 9);
  expect(a.getInitial(L.qty)).toBe(1);
  lines.move(a, 1);
  expect(lines.itemAt(1)).toBe(a);
  expect(a.getInitial(L.qty)).toBe(1);
  expect(b.getInitial(L.sku)).toBe("B");
});

it("new rows start from {}", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).append();
  expect(row.getInitial(L.sku)).toBe(undefined);
  expect(row.get(L.qty)).toBe(1);
});

it("a baseline write on the array makes current rows initial", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.append({ sku: "N" });
  expect(row.getInitial(L.sku)).toBe(undefined);
  s.set(shape.lines, lines.current().slice(), { as: "initial" });
  expect(row.getInitial(L.sku)).toBe("N");
});

it("reset restores values and meta, keeps rows and focus targets", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  const target: FocusTarget = { focus() {} };
  s.set(shape.name, "Bob");
  s.set(shape.name.error, "x");
  s.set(shape.name.focusTarget, target);
  row.set(L.qty, 5);
  row.set(L.sku.error, "bad");
  lines.append();

  s.reset();

  expect(s.get(shape.name)).toBe("Ann");
  expect(s.get(shape.name.error)).toBe(undefined);
  expect(s.get(shape.name.focusTarget), "focus target kept").toBe(target);
  expect(lines.items().length).toBe(2);
  expect(lines.itemAt(0), "same row store after reset").toBe(row);
  expect(row.get(L.qty)).toBe(1);
  expect(row.get(L.sku.error)).toBe(undefined);
  expect(s.get(countIn(shape, "error"))).toBe(0);
});

it("reset of one row", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.sku, "Z");
  row.set(L.sku.touched, true);
  row.reset();
  expect(row.get(L.sku)).toBe("B");
  expect(row.get(L.sku.touched)).toBe(false);
});

// ---------------------------------------------------------------------------
// Array helpers
it("append / insert / remove / move", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const c = lines.append({ sku: "C" });
  expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "C"]);
  expect(c.get(L.qty), "factory default kept").toBe(1);
  const z = lines.insert(0, { sku: "Z", qty: 3 });
  expect(lines.items().map((r) => r.get(L.sku))).toEqual(["Z", "A", "B", "C"]);
  lines.move(z, 3);
  expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "C", "Z"]);
  lines.remove(c);
  expect(lines.items().map((r) => r.get(L.sku))).toEqual(["A", "B", "Z"]);
  expect(c.isAttached()).toBe(false);
  expect(() => lines.remove(c)).toThrow(/detached/);
});

it("arrays without create need complete items", () => {
  const s = createStore(shape, initial());
  const tags = s.substore(shape.tags);
  tags.append({ text: "t" });
  expect(tags.items().length).toBe(1);
  // @ts-expect-error – no create factory: an item is required
  expect(() => tags.append()).toThrow(/no `create` factory/);
});

it("helpers pass the origin through", () => {
  const s = createStore(shape, initial());
  const seen: Origin[][] = [];
  s.react(shape.lines, (_n, _p, i) => seen.push([...i.origins]));
  s.substore(shape.lines).append(undefined, { origin: "user" });
  expect(seen).toEqual([["user"]]);
});

// ---------------------------------------------------------------------------
// Counts and collect
it("counts across fields, objects and rows", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  s.set(shape.name.error, "x");
  s.set(shape.company.vat.error, "y");
  a.set(L.sku.error, "z");
  b.set(L.sku.error, "w");
  expect(s.get(countIn(shape, "error"))).toBe(4);
  expect(s.get(countIn(shape.company, "error"))).toBe(1);
  expect(s.get(countIn(shape.lines, "error"))).toBe(2);
  expect(a.get(countIn(L, "error"))).toBe(1);
  a.set(L.sku.error, undefined);
  expect(s.get(countIn(shape, "error"))).toBe(3);
});

it("removing and restoring rows moves their counts", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  row.set(L.sku.error, "z");
  const note = row.substore(L.notes).itemAt(0);
  note.set(L.notes.item.text.error, "n");
  expect(s.get(countIn(shape, "error"))).toBe(2);

  const before = lines.current().slice();
  s.set(shape.lines, [before[1]]);
  expect(s.get(countIn(shape, "error")), "detached row no longer counts").toBe(0);
  s.set(shape.lines, before);
  expect(s.get(countIn(shape, "error")), "restored row counts again").toBe(2);
});

it("count subscriptions fire on changes and row removal", () => {
  const s = createStore(shape, initial());
  const seen: number[] = [];
  s.subscribe(countIn(shape, "error"), () => seen.push(s.get(countIn(shape, "error"))));
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.sku.error, "z");
  s.set(shape.name.error, "x");
  s.substore(shape.lines).remove(row);
  expect(seen).toEqual([1, 2, 1]);
});

it("collect lists matching nodes with row indexes", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  s.set(shape.email.error, "e");
  lines.itemAt(1).set(L.sku.error, "s");
  lines.itemAt(0).substore(L.notes).itemAt(0).set(L.notes.item.text.error, "n");
  const found = s.collect(shape, "error").map((e) => e.path);
  expect(found).toEqual(["email", "lines[0].notes[0].text", "lines[1].sku"]);
  const entry = s.collect(shape.lines, "error").find((e) => e.path === "lines[1].sku")!;
  expect(entry.store).toBe(lines.itemAt(1));
  expect(entry.ref).toBe(L.sku);
});

it("countIn warns when nothing in the subtree can aggregate the key", () => {
  const local = form(
    object({
      a: field<string>().meta(control()),
      b: field<boolean>().meta({ flag: false }),
    })
  );
  const original = console.warn;
  const seen: string[] = [];
  console.warn = (...args: unknown[]) => void seen.push(args.join(" "));
  try {
    expect(countIn(local, "error")).toBeDefined(); // aggregable: silent
    countIn(local, "flag"); // declared, but a plain value: always 0
    countIn(local, "flag"); // cached ref: still one warning
    countIn(local, "nope"); // not declared at all (e.g. a typo)
    expect(countIn(local, "error")).toBe(countIn(local, "error"));
  } finally {
    console.warn = original;
  }
  expect(seen.length).toBe(2);
  expect(seen[0]).toMatch(/"flag"/);
  expect(seen[1]).toMatch(/"nope"/);
});

it("aggregate must be false for the default", async () => {
  const { metaKey } = await import("./meta");
  expect(() => metaKey(true, { aggregate: (v) => v })).toThrow(/default value/);
});

// ---------------------------------------------------------------------------
// Inheritance
it("visible: hidden if any ancestor is hidden", () => {
  const s = createStore(shape, initial());
  expect(s.get(shape.company.address.city.visible)).toBe(true);
  s.set(shape.company.visible, false);
  expect(s.get(shape.company.address.city.visible)).toBe(false);
  expect(s.getOwn(shape.company.address.city.visible)).toBe(true);
  s.set(shape.company.visible, true);
  s.set(shape.company.address.visible, false);
  expect(s.get(shape.company.address.city.visible)).toBe(false);
  expect(s.get(shape.company.vat.visible)).toBe(true);
});

it("disabled: inherited from the root and through arrays into rows", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  expect(row.get(L.sku.disabled)).toBe(false);
  s.set(shape.lines.disabled, true);
  expect(row.get(L.sku.disabled)).toBe(true);
  s.set(shape.lines.disabled, false);
  s.set(shape.disabled, true);                  // form-wide read-only
  expect(row.get(L.sku.disabled)).toBe(true);
  expect(s.get(shape.company.vat.disabled)).toBe(true);
});

it("subscriptions to inherited values fire when an ancestor changes", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const seen: boolean[] = [];
  row.subscribe(L.sku.disabled, () => seen.push(row.get(L.sku.disabled)));
  s.set(shape.disabled, true);
  s.set(shape.lines.disabled, true);           // already effectively disabled: no change
  s.set(shape.disabled, false);                // still disabled via lines
  s.set(shape.lines.disabled, false);
  expect(seen).toEqual([true, false]);
});

// ---------------------------------------------------------------------------
// Non-reactive keys
it("focus targets never notify and work on detached rows", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  let calls = 0;
  s.subscribe(() => calls++);
  row.subscribeMeta(L.sku, () => calls++);
  const target: FocusTarget = { focus() {} };
  row.set(L.sku.focusTarget, target);
  expect(calls).toBe(0);
  expect(row.get(L.sku.focusTarget)).toBe(target);
  lines.remove(row);
  calls = 0;
  row.set(L.sku.focusTarget, undefined);        // unmount after removal must not throw
  expect(calls).toBe(0);
});

// Compile-time only – never called.
export function typeOnlyChecks() {
  const s = createStore(shape, initial());
  const b: boolean = s.get(shape.name.touched);
  const e: string | undefined = s.get(shape.name.error);
  const n: number = s.get(countIn(shape, "error"));
  const v: string = s.get(shape.name);
  // @ts-expect-error – a meta ref is not a count
  const wrong: number = s.get(shape.name.touched);
  // @ts-expect-error – value type is checked
  s.set(shape.name.touched, "yes");
  return [b, e, n, v, wrong];
}
