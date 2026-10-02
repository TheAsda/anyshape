// ============================================================
// Integration (React): the whole trip booking rendered, a keystroke's reach.
// ============================================================

import { test, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { createStore, countIn, type ItemStore } from "../index";
import { error } from "../test/features";
import { pattern } from "../test/rules";
import { StoreProvider, useArray, useBehaviors, useField, useValue } from "./index";
import { trip, T, tripBehaviors, savedBooking, quiet } from "../test/trip";
import { render, renders } from "./test-utils";

const c = renders();

function NameField({ who }: { who: string }) {
  const f = useField(T.name);
  c.hit(`name:${who}`);
  const reveal = () => f.store.set(T.name.revealed, true, { origin: "user" });
  return <input data-testid={`name-${who}`} value={f.value} onChange={(e) => f.onChange(e.target.value)} onBlur={reveal} />;
}
function PassportField({ who }: { who: string }) {
  useBehaviors((b) => b.add(pattern(T.passport, /^[A-Z]/, { message: "Starts with a letter" })), []);
  const f = useField(T.passport);
  c.hit(`passport:${who}`);
  return <input data-testid={`passport-${who}`} value={f.value} onChange={(e) => f.onChange(e.target.value)} />;
}
function TravelerRow({ who }: { who: string }) {
  c.hit(`row:${who}`);
  return (
    <fieldset>
      <NameField who={who} />
      <PassportField who={who} />
    </fieldset>
  );
}
function Travelers() {
  const { items } = useArray(trip.travelers);
  c.hit("list");
  return (
    <div>
      {items.map((row: ItemStore<typeof T>, i) => (
        <StoreProvider key={row.stableId} store={row}>
          <TravelerRow who={String(i)} />
        </StoreProvider>
      ))}
    </div>
  );
}
function ErrorCounter() {
  const n = useValue(countIn(trip, error));
  c.hit("counter");
  return <span data-testid="errors">{String(n)}</span>;
}
function Destination() {
  const f = useField(trip.destination);
  c.hit("destination");
  return <input value={f.value} onChange={(e) => f.onChange(e.target.value)} />;
}

test("INT9 a keystroke in one traveler re-renders only that field, and the counter only when the count changes", async () => {
  const s = createStore(trip, savedBooking(), { behaviors: tripBehaviors(), ...quiet });
  const screen = await render(
    <StoreProvider store={s}>
      <Destination />
      <Travelers />
      <ErrorCounter />
    </StoreProvider>
  );
  const errors = screen.getByTestId("errors");
  const [, tim] = s.substore(trip.travelers).items();
  await expect.element(errors, { message: "Tim's passport: required" }).toHaveTextContent("1");

  const timName = screen.getByTestId("name-1");
  await userEvent.click(timName); // focus first, so the keystroke below is the only change
  c.reset();

  await userEvent.keyboard("{End}o");
  expect(tim.get(T.name)).toBe("Timo");
  expect(c.counts, "a valid edit: only Tim's name field").toEqual({ "name:1": 1 });
  c.reset();

  await timName.fill("");
  await expect.element(errors).toHaveTextContent("2");
  expect(c.counts, "now invalid: the counter too").toEqual({ "name:1": 1, counter: 1 });
  c.reset();

  // Moving to the passport field blurs Tim's name, which reveals it: one more
  // render of that field, in a real browser as with a real user.
  const timPassport = screen.getByTestId("passport-1");
  await timPassport.fill("12345678");
  expect(tim.get(T.passport.error), "the rule registered by the component, on Tim's row").toBe("Starts with a letter");
  expect(c.counts).toEqual({ "name:1": 1, "passport:1": 1 });
  await expect.element(errors, { message: "Required swapped for another error: same count" }).toHaveTextContent("2");

  await screen.unmount();
  expect(tim.get(T.passport.error), "the component's rule left with it; the form's own rules pass").toBe(undefined);
});
