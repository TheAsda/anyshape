import type { StageMeta } from "../../ui";

// Presentation metadata for this stage — index.tsx stays pure demo code.
export const meta: StageMeta = {
  title: "Steps",
  story: "The booking splits into the trip and the extras, and the room type has no sensible default.",
  bullets: [
    "field<RoomType | undefined>().meta(control(), { defined }) — a field that starts empty, and its type says so",
    "{ defined } adds 'Required' while the value is undefined — no rule to write; a required() you add speaks first",
    "Each step is a section with submission(); Next is handleSubmit(form.substore(shape.trip), fn) — it reveals and validates the trip only",
    "fn gets the checked type: roomType is a RoomType there, no undefined left",
    "Step 2 reads roomType with useValue: the stored type, RoomType | undefined, narrowed with === undefined",
  ],
  notes:
    "Press Next with nothing filled in: the trip's fields light up, the extras aren't touched — they aren't part of this step's submit. Pick a room type and press Next: its fn receives the checked type, where roomType is a RoomType, because validating proved the value is there. Step 2's summary reads roomType with useValue instead, and there the stored type still says RoomType | undefined, so it checks === undefined before indexing the labels. That's not pedantry: going back and picking 'Choose…' clears it. Book submits the whole form, step 1 included; when a step-1 field fails, from the checks or the server, it goes back to step 1 and focuses it. Forcing field<RoomType>() with a made-up start value compiles once and then lies.",
};
