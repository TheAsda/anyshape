// ============================================================
// The presentation shell: stage tabs, keyboard navigation,
// story header, speaker notes and the "what's new" bullets.
// The stage source itself is not shown here — open the stage
// folder in your editor next to the slides.
// ============================================================

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { StageMeta } from "./ui";
import { meta as meta1 } from "./stages/stage1/meta";
import { Stage as Stage1 } from "./stages/stage1";
import { meta as meta2 } from "./stages/stage2/meta";
import { Stage as Stage2 } from "./stages/stage2";
import { meta as meta3 } from "./stages/stage3/meta";
import { Stage as Stage3 } from "./stages/stage3";
import { meta as meta4 } from "./stages/stage4/meta";
import { Stage as Stage4 } from "./stages/stage4";
import { meta as meta5 } from "./stages/stage5/meta";
import { Stage as Stage5 } from "./stages/stage5";
import { meta as meta6 } from "./stages/stage6/meta";
import { Stage as Stage6 } from "./stages/stage6";
import { meta as meta7 } from "./stages/stage7/meta";
import { Stage as Stage7 } from "./stages/stage7";
import { meta as meta8 } from "./stages/stage8/meta";
import { Stage as Stage8 } from "./stages/stage8";
import { meta as meta9 } from "./stages/stage9/meta";
import { Stage as Stage9 } from "./stages/stage9";
import { meta as meta10 } from "./stages/stage10/meta";
import { Stage as Stage10 } from "./stages/stage10";
import { meta as meta11 } from "./stages/stage11/meta";
import { Stage as Stage11 } from "./stages/stage11";
import { meta as meta12 } from "./stages/stage12/meta";
import { Stage as Stage12 } from "./stages/stage12";
import { meta as meta13 } from "./stages/stage13/meta";
import { Stage as Stage13 } from "./stages/stage13";

type StageDef = {
  meta: StageMeta;
  Stage: ComponentType;
};

const stages: StageDef[] = [
  { meta: meta1, Stage: Stage1 },
  { meta: meta2, Stage: Stage2 },
  { meta: meta3, Stage: Stage3 },
  { meta: meta4, Stage: Stage4 },
  { meta: meta5, Stage: Stage5 },
  { meta: meta6, Stage: Stage6 },
  { meta: meta7, Stage: Stage7 },
  { meta: meta8, Stage: Stage8 },
  { meta: meta9, Stage: Stage9 },
  { meta: meta10, Stage: Stage10 },
  { meta: meta11, Stage: Stage11 },
  { meta: meta12, Stage: Stage12 },
  { meta: meta13, Stage: Stage13 },
];

export function Shell() {
  const [index, setIndex] = useState(0);
  const { meta, Stage } = stages[index];

  // Arrow keys advance the slides (unless typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, stages.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="deck">
      <header className="deck__header">
        <h1>
          form-lib <span>· a form grows up</span>
        </h1>
        <nav className="deck__tabs" aria-label="Stages">
          {stages.map((s, i) => (
            <button
              key={s.meta.title}
              className={`deck__tab ${i === index ? "is-active" : ""}`}
              onClick={() => setIndex(i)}
            >
              <span className="deck__tabnum">{i + 1}</span> {s.meta.title}
            </button>
          ))}
        </nav>
      </header>

      <p className="deck__story">
        <strong>
          Stage {index + 1} — {meta.title}:
        </strong>{" "}
        {meta.story}
      </p>
      <p className="deck__notes">{meta.notes}</p>

      <main className="deck__main">
        <section className="deck__live" aria-label="Live form">
          {/* key forces a fresh form per stage switch */}
          <Stage key={index} />
        </section>
        <section className="deck__side" aria-label="What's new">
          <h2>What&rsquo;s new</h2>
          <ul>
            {meta.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="deck__footer">
        <button
          className="button"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          ← Prev
        </button>
        <span className="deck__counter">
          {index + 1} / {stages.length}
        </span>
        <button
          className="button"
          disabled={index === stages.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          Next →
        </button>
      </footer>
    </div>
  );
}
