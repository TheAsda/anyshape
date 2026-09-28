// Run: npx tsx src/extensions.test.ts   (type assertions: npx tsc)
import {
  form, object, array, field, createStore, countIn,
  control, validation, touched, visibility, disableable,
  type InferValue, type Origin, type FocusTarget,
} from "./index";
import { test, eq, deepEq, throws, report } from "./test/harness";

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
test("get / set with value and meta refs", () => {
  const s = createStore(shape, initial());
  eq(s.get(shape.name), "Ann");
  s.set(shape.name, "Bob");
  eq(s.getValue(shape.name), "Bob");
  s.set(shape.name.error, "Bad");
  eq(s.get(shape.name.error), "Bad");
  eq(s.getMeta(shape.name).error, "Bad");
});

test("subscribe to a single meta key ignores other keys", () => {
  const s = createStore(shape, initial());
  let calls = 0;
  s.subscribe(shape.name.error, () => calls++);
  s.set(shape.name.touched, true);
  eq(calls, 0);
  s.set(shape.name.error, "x");
  eq(calls, 1);
});

test("counts are read-only", () => {
  const s = createStore(shape, initial());
  throws(() => s.set(countIn(shape, "error") as any, 1 as never), /read-only/);
});

// ---------------------------------------------------------------------------
// Origins
function originsOf(fn: (record: (o: ReadonlySet<Origin>) => void) => void): Origin[][] {
  const seen: Origin[][] = [];
  fn((o) => seen.push([...o].sort()));
  return seen;
}

test("reactions receive the origin of the write", () => {
  const s = createStore(shape, initial());
  const seen = originsOf((rec) => s.react(shape.name, (_n, _p, info) => rec(info.origins)));
  s.set(shape.name, "U", { origin: "user" });
  s.set(shape.name, "P");
  s.set(shape.name, "I", { as: "initial" });
  deepEq(seen, [["user"], ["program"], ["initial"]]);
});

test("origins are tracked per target within one batch", () => {
  const s = createStore(shape, initial());
  const name: Origin[][] = [];
  const email: Origin[][] = [];
  s.react(shape.name, (_n, _p, i) => name.push([...i.origins]));
  s.react(shape.email, (_n, _p, i) => email.push([...i.origins]));
  s.batch(() => {
    s.set(shape.name, "U", { origin: "user" });
    s.set(shape.email, "p@x.io");
  });
  deepEq(name, [["user"]]);
  deepEq(email, [["program"]]);
});

test("origins cross scopes in both directions", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  const toRoot: Origin[][] = [];
  const toRow: Origin[][] = [];
  s.react(shape.lines, (_n, _p, i) => toRoot.push([...i.origins]));
  row.react(L.sku, (_n, _p, i) => toRow.push([...i.origins]));

  row.set(L.sku, "Z", { origin: "user" });              // row → enclosing array
  deepEq(toRoot, [["user"]]);
  deepEq(toRow, [["user"]]);

  const current = s.getValues().lines;
  s.set(shape.lines, [current[1]]);                      // array write detaches the row
  deepEq(toRow.at(-1), ["program"]);
});

test("a write in one row is not an origin for another row", () => {
  const s = createStore(shape, initial());
  const [a, b] = s.substore(shape.lines).items();
  let bCalls = 0;
  b.react(L.sku, () => bCalls++);
  a.set(L.sku, "Z", { origin: "user" });
  eq(bCalls, 0);
});

test("meta reactions receive origins", () => {
  const s = createStore(shape, initial());
  const seen: Origin[][] = [];
  s.react(shape.name.error, (_n, _p, i) => seen.push([...i.origins]));
  s.set(shape.name.error, "x", { origin: "behavior:required" });
  deepEq(seen, [["behavior:required"]]);
});

// ---------------------------------------------------------------------------
// Initial values
test("getInitial and { as: 'initial' }", () => {
  const s = createStore(shape, initial());
  s.set(shape.name, "Bob");
  eq(s.getInitial(shape.name), "Ann");
  s.set(shape.name, "Cid", { as: "initial" });
  eq(s.getInitial(shape.name), "Cid");
  eq(s.get(shape.name), "Cid");
});

test("rows keep their own initial value through edits and reordering", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  a.set(L.qty, 9);
  eq(a.getInitial(L.qty), 1);
  lines.move(a, 1);
  eq(lines.itemAt(1), a);
  eq(a.getInitial(L.qty), 1);
  eq(b.getInitial(L.sku), "B");
});

test("new rows start from {}", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).append();
  eq(row.getInitial(L.sku), undefined);
  eq(row.get(L.qty), 1);
});

test("a baseline write on the array makes current rows initial", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.append({ sku: "N" });
  eq(row.getInitial(L.sku), undefined);
  s.set(shape.lines, lines.current().slice(), { as: "initial" });
  eq(row.getInitial(L.sku), "N");
});

test("reset restores values and meta, keeps rows and focus targets", () => {
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

  eq(s.get(shape.name), "Ann");
  eq(s.get(shape.name.error), undefined);
  eq(s.get(shape.name.focusTarget), target, "focus target kept");
  eq(lines.items().length, 2);
  eq(lines.itemAt(0), row, "same row store after reset");
  eq(row.get(L.qty), 1);
  eq(row.get(L.sku.error), undefined);
  eq(s.get(countIn(shape, "error")), 0);
});

test("reset of one row", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.sku, "Z");
  row.set(L.sku.touched, true);
  row.reset();
  eq(row.get(L.sku), "B");
  eq(row.get(L.sku.touched), false);
});

// ---------------------------------------------------------------------------
// Array helpers
test("append / insert / remove / move", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const c = lines.append({ sku: "C" });
  deepEq(lines.items().map((r) => r.get(L.sku)), ["A", "B", "C"]);
  eq(c.get(L.qty), 1, "factory default kept");
  const z = lines.insert(0, { sku: "Z", qty: 3 });
  deepEq(lines.items().map((r) => r.get(L.sku)), ["Z", "A", "B", "C"]);
  lines.move(z, 3);
  deepEq(lines.items().map((r) => r.get(L.sku)), ["A", "B", "C", "Z"]);
  lines.remove(c);
  deepEq(lines.items().map((r) => r.get(L.sku)), ["A", "B", "Z"]);
  eq(c.isAttached(), false);
  throws(() => lines.remove(c), /detached/);
});

test("arrays without create need complete items", () => {
  const s = createStore(shape, initial());
  const tags = s.substore(shape.tags);
  tags.append({ text: "t" });
  eq(tags.items().length, 1);
  // @ts-expect-error – no create factory: an item is required
  throws(() => tags.append(), /no `create` factory/);
});

test("helpers pass the origin through", () => {
  const s = createStore(shape, initial());
  const seen: Origin[][] = [];
  s.react(shape.lines, (_n, _p, i) => seen.push([...i.origins]));
  s.substore(shape.lines).append(undefined, { origin: "user" });
  deepEq(seen, [["user"]]);
});

// ---------------------------------------------------------------------------
// Counts and collect
test("counts across fields, objects and rows", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const [a, b] = lines.items();
  s.set(shape.name.error, "x");
  s.set(shape.company.vat.error, "y");
  a.set(L.sku.error, "z");
  b.set(L.sku.error, "w");
  eq(s.get(countIn(shape, "error")), 4);
  eq(s.get(countIn(shape.company, "error")), 1);
  eq(s.get(countIn(shape.lines, "error")), 2);
  eq(a.get(countIn(L, "error")), 1);
  a.set(L.sku.error, undefined);
  eq(s.get(countIn(shape, "error")), 3);
});

test("removing and restoring rows moves their counts", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  row.set(L.sku.error, "z");
  const note = row.substore(L.notes).itemAt(0);
  note.set(L.notes.item.text.error, "n");
  eq(s.get(countIn(shape, "error")), 2);

  const before = lines.current().slice();
  s.set(shape.lines, [before[1]]);
  eq(s.get(countIn(shape, "error")), 0, "detached row no longer counts");
  s.set(shape.lines, before);
  eq(s.get(countIn(shape, "error")), 2, "restored row counts again");
});

test("count subscriptions fire on changes and row removal", () => {
  const s = createStore(shape, initial());
  const seen: number[] = [];
  s.subscribe(countIn(shape, "error"), () => seen.push(s.get(countIn(shape, "error"))));
  const row = s.substore(shape.lines).itemAt(1);
  row.set(L.sku.error, "z");
  s.set(shape.name.error, "x");
  s.substore(shape.lines).remove(row);
  deepEq(seen, [1, 2, 1]);
});

test("collect lists matching nodes with row indexes", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  s.set(shape.email.error, "e");
  lines.itemAt(1).set(L.sku.error, "s");
  lines.itemAt(0).substore(L.notes).itemAt(0).set(L.notes.item.text.error, "n");
  const found = s.collect(shape, "error").map((e) => e.path);
  deepEq(found, ["email", "lines[0].notes[0].text", "lines[1].sku"]);
  const entry = s.collect(shape.lines, "error").find((e) => e.path === "lines[1].sku")!;
  eq(entry.store, lines.itemAt(1));
  eq(entry.ref, L.sku);
});

test("aggregate must be false for the default", async () => {
  const { metaKey } = await import("./meta");
  throws(() => metaKey(true, { aggregate: (v) => v }), /default value/);
});

// ---------------------------------------------------------------------------
// Inheritance
test("visible: hidden if any ancestor is hidden", () => {
  const s = createStore(shape, initial());
  eq(s.get(shape.company.address.city.visible), true);
  s.set(shape.company.visible, false);
  eq(s.get(shape.company.address.city.visible), false);
  eq(s.getOwn(shape.company.address.city.visible), true);
  s.set(shape.company.visible, true);
  s.set(shape.company.address.visible, false);
  eq(s.get(shape.company.address.city.visible), false);
  eq(s.get(shape.company.vat.visible), true);
});

test("disabled: inherited from the root and through arrays into rows", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  eq(row.get(L.sku.disabled), false);
  s.set(shape.lines.disabled, true);
  eq(row.get(L.sku.disabled), true);
  s.set(shape.lines.disabled, false);
  s.set(shape.disabled, true);                  // form-wide read-only
  eq(row.get(L.sku.disabled), true);
  eq(s.get(shape.company.vat.disabled), true);
});

test("subscriptions to inherited values fire when an ancestor changes", () => {
  const s = createStore(shape, initial());
  const row = s.substore(shape.lines).itemAt(0);
  const seen: boolean[] = [];
  row.subscribe(L.sku.disabled, () => seen.push(row.get(L.sku.disabled)));
  s.set(shape.disabled, true);
  s.set(shape.lines.disabled, true);           // already effectively disabled: no change
  s.set(shape.disabled, false);                // still disabled via lines
  s.set(shape.lines.disabled, false);
  deepEq(seen, [true, false]);
});

// ---------------------------------------------------------------------------
// Non-reactive keys
test("focus targets never notify and work on detached rows", () => {
  const s = createStore(shape, initial());
  const lines = s.substore(shape.lines);
  const row = lines.itemAt(0);
  let calls = 0;
  s.subscribe(() => calls++);
  row.subscribeMeta(L.sku, () => calls++);
  const target: FocusTarget = { focus() {} };
  row.set(L.sku.focusTarget, target);
  eq(calls, 0);
  eq(row.get(L.sku.focusTarget), target);
  lines.remove(row);
  calls = 0;
  row.set(L.sku.focusTarget, undefined);        // unmount after removal must not throw
  eq(calls, 0);
});

report("extensions.test.ts");

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
