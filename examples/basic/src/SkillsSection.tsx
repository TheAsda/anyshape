// ============================================================
// An array field: useArray gives the row stores and the write
// helpers. Each row is rendered inside a StoreProvider for that
// row; inside it, the row template's fields (Skill.name, …)
// resolve to that row.
// ============================================================

import { StoreProvider, useArray } from "form-lib/react";
import { shape } from "./form";
import { TextField, NumberField } from "./fields";

const Skill = shape.skills.item;

function SkillRow({ index, onRemove }: { index: number; onRemove: () => void }) {
  return (
    <div className="skill-row">
      <span className="skill-row__index">{index + 1}</span>
      <TextField node={Skill.name} label="Skill" placeholder="e.g. TypeScript" />
      <NumberField node={Skill.level} label="Level" min={1} max={5} />
      <button type="button" className="btn btn--ghost skill-row__remove" onClick={onRemove} aria-label={`Remove skill ${index + 1}`}>
        Remove
      </button>
    </div>
  );
}

export function SkillsSection() {
  const skills = useArray(shape.skills);

  return (
    <fieldset className="skills">
      <legend className="field__label">Skills</legend>
      <p className="field__hint">Leave a row empty to skip it, or fill in both the skill and its level (1–5).</p>
      {skills.items.length === 0 && <p className="skills__empty">No skills yet.</p>}
      {skills.items.map((row, index) => (
        <StoreProvider key={row.stableId} store={row}>
          <SkillRow index={index} onRemove={() => skills.remove(row)} />
        </StoreProvider>
      ))}
      <button type="button" className="btn btn--ghost" onClick={() => skills.append()}>
        Add skill
      </button>
    </fieldset>
  );
}
