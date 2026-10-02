// ============================================================
// Diagnostics (dev only, internal)
// ------------------------------------------------------------
// createStore installs a probe on the root in dev (isDev); a production build
// installs none, so nothing is measured. The probe feeds two consumers:
//   • the flush budget: a flush over FLUSH_BUDGET logs one console.warn with
//     its time in reactions and in UI listeners, and the three behaviors that
//     took the most time across their instances;
//   • the DevTools performance tracks.
// Time counted against the budget: everything inside the flush, plus applying
// an async run's writes (in the batch that starts the flush). A run in flight
// is not: it is mostly waiting.
// ============================================================

import type { Probe, ProbedInstance, RunPart, RegistrationChange } from "./store";

/** One frame at 30 fps, in ms. */
export const FLUSH_BUDGET = 1000 / 30;

/** One behavior's time in the current flush, over all its instances. */
interface Tally {
  readonly reg: ProbedInstance["reg"];
  time: number;
  runs: number;
  listed: boolean;
}

interface FlushReport {
  readonly total: number;
  readonly reactions: number;
  readonly ui: number;
  /** At most three, slowest first. */
  readonly slowest: readonly Tally[];
}

/**
 * Times each flush. Allocation-free while a flush is within budget: tallies
 * are kept per registration and reset in place.
 */
class FlushBudget {
  private start = 0;
  private reactionsAt = 0;
  private reactionsDone = false;
  private open = false;
  /** Run parts before the flush (applying async writes): they count towards it. */
  private carry = 0;
  private runAt = 0;
  private readonly tallies = new WeakMap<object, Tally>();
  private readonly listed: Tally[] = [];

  flushStart(at: number): void {
    this.start = at;
    this.reactionsDone = false;
    this.open = true;
  }

  reactionsEnd(at: number): void {
    this.reactionsAt = at;
    this.reactionsDone = true;
  }

  /** The flush's report when it is over budget. */
  flushEnd(at: number): FlushReport | undefined {
    this.open = false;
    const total = at - this.start + this.carry;
    let report: FlushReport | undefined;
    if (total > FLUSH_BUDGET) {
      const reactionsAt = this.reactionsDone ? this.reactionsAt : at;
      const slowest = [...this.listed].sort((a, b) => b.time - a.time).slice(0, 3).map((t) => ({ ...t }));
      report = { total, reactions: reactionsAt - this.start + this.carry, ui: at - reactionsAt, slowest };
    }
    for (const tally of this.listed) {
      tally.time = 0;
      tally.runs = 0;
      tally.listed = false;
    }
    this.listed.length = 0;
    this.carry = 0;
    return report;
  }

  runStart(at: number): void {
    this.runAt = at;
  }

  runEnd(instance: ProbedInstance, at: number, part: RunPart): void {
    const time = at - this.runAt;
    let tally = this.tallies.get(instance.reg);
    if (!tally) this.tallies.set(instance.reg, (tally = { reg: instance.reg, time: 0, runs: 0, listed: false }));
    if (!tally.listed) {
      tally.listed = true;
      this.listed.push(tally);
    }
    tally.time += time;
    if (part !== "apply") tally.runs++;
    if (!this.open) this.carry += time;
  }
}

const ms = (n: number) => `${n.toFixed(1)} ms`;

function overBudget(report: FlushReport): string {
  const slowest = report.slowest
    .map((t) => `"${t.reg.name}" ${ms(t.time)}${t.runs ? ` (${t.runs} ${t.runs === 1 ? "run" : "runs"})` : ""}`)
    .join(", ");
  return (
    `[form] A flush took ${ms(report.total)}, over the ${ms(FLUSH_BUDGET)} budget: ` +
    `${ms(report.reactions)} in reactions, ${ms(report.ui)} in UI listeners.` +
    (slowest ? ` Slowest behaviors: ${slowest}.` : "")
  );
}

/** The probe createStore installs in dev. */
export class Diagnostics implements Probe {
  private readonly budget = new FlushBudget();

  flushStart(at: number): void {
    this.budget.flushStart(at);
  }
  reactionsEnd(at: number): void {
    this.budget.reactionsEnd(at);
  }
  flushEnd(at: number): void {
    const report = this.budget.flushEnd(at);
    if (report) console.warn(overBudget(report));
  }
  runStart(_instance: ProbedInstance, at: number): void {
    this.budget.runStart(at);
  }
  runEnd(instance: ProbedInstance, at: number, part: RunPart): void {
    this.budget.runEnd(instance, at, part);
  }
  flightEnd(_instance: ProbedInstance, _at: number, _cancelled: boolean): void {}
  registrationStart(_at: number): void {}
  registrationEnd(_at: number, _describe: () => RegistrationChange): void {}
}
