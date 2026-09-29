// ============================================================
// Integration (React): the whole trip booking rendered, a keystroke's reach.
// ============================================================

import { createElement as h, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createStore, countIn, pattern, type ItemStore } from "../index";
import { StoreProvider, useArray, useBehaviors, useControl, useValue, fromInput } from "./index";
import { trip, T, tripBehaviors, savedBooking, quiet } from "../test/trip";
import "./test-setup";
import { it, expect } from "vitest";

let root: Root | undefined;
async function mount(node: ReactNode) {
  root = createRoot(document.getElementById("root")!);
  await act(async () => root!.render(node));
}
function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const renders: Record<string, number> = {};
const hit = (k: string) => void (renders[k] = (renders[k] ?? 0) + 1);
const clear = () => Object.keys(renders).forEach((k) => delete renders[k]);

function NameField({ who }: { who: string }) {
  const c = useControl(T.name);
  hit(`name:${who}`);
  return h("input", { id: `name-${who}`, value: c.value, onChange: fromInput(c.onChange), onBlur: c.onBlur });
}
function PassportField({ who }: { who: string }) {
  useBehaviors((b) => b.add(pattern(T.passport, /^[A-Z]/, { message: "Starts with a letter" })), []);
  const c = useControl(T.passport);
  hit(`passport:${who}`);
  return h("input", { id: `passport-${who}`, value: c.value, onChange: fromInput(c.onChange) });
}
function TravelerRow({ who }: { who: string }) {
  hit(`row:${who}`);
  return h("fieldset", {}, h(NameField, { who }), h(PassportField, { who }));
}
function Travelers() {
  const { items } = useArray(trip.travelers);
  hit("list");
  return h(
    "div",
    {},
    items.map((row: ItemStore<typeof T>, i) =>
      h(StoreProvider, { key: row.stableId, store: row }, h(TravelerRow, { who: String(i) }))
    )
  );
}
function ErrorCounter() {
  const n = useValue(countIn(trip, "error"));
  hit("counter");
  return h("span", { id: "errors" }, String(n));
}
function Destination() {
  const c = useControl(trip.destination);
  hit("destination");
  return h("input", { value: c.value, onChange: fromInput(c.onChange) });
}

it("INT9 a keystroke in one traveler re-renders only that field, and the counter only when the count changes", async () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  await mount(h(StoreProvider, { store: s }, h(Destination, {}), h(Travelers, {}), h(ErrorCounter, {})));
  const errors = () => document.getElementById("errors")!.textContent;
  const [, tim] = s.substore(trip.travelers).items();
  expect(errors(), "Tim's passport: required").toBe("1");
  clear();

  const timName = document.getElementById("name-1") as HTMLInputElement;
  await act(async () => typeInto(timName, "Timo"));
  expect(tim.get(T.name)).toBe("Timo");
  expect(renders, "a valid edit: only Tim's name field").toEqual({ "name:1": 1 });
  clear();

  await act(async () => typeInto(timName, ""));
  expect(errors()).toBe("2");
  expect(renders, "now invalid: the counter too").toEqual({ "name:1": 1, counter: 1 });
  clear();

  const timPassport = document.getElementById("passport-1") as HTMLInputElement;
  await act(async () => typeInto(timPassport, "12345678"));
  expect(tim.get(T.passport.error), "the rule registered by the component, on Tim's row").toBe("Starts with a letter");
  expect(renders).toEqual({ "passport:1": 1 });
  expect(errors(), "Required swapped for another error: same count").toBe("2");

  await act(async () => root!.unmount());
  expect(tim.get(T.passport.error), "the component's rule left with it; the form's own rules pass").toBe(undefined);
});
