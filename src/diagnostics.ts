// ============================================================
// Diagnostics (dev only, internal)
// ------------------------------------------------------------
// createStore installs a probe on the root in dev (isDev); a production build
// installs none, so nothing is measured. The probe feeds two consumers:
//   • the flush budget: a flush over FLUSH_BUDGET logs one console.warn with
//     its time in reactions and in UI listeners, and the three behaviors that
//     took the most time across their instances;
//   • the DevTools performance tracks (track group "form-lib"): frequent
//     entries through the extended console.timeStamp, rare detailed ones
//     through performance.measure with detail.devtools. Both are
//     feature-detected; other tools ignore the extra arguments and detail.
// Time counted against the budget: everything inside the flush, plus applying
// an async run's writes (in the batch that starts the flush). A run in flight
// is not: it is mostly waiting.
// ============================================================

import type { BaseStore, Probe, ProbedInstance, RunPart, RegistrationChange } from "./store";
import type { AnyNode } from "./shape";
import { concretePath } from "./internal";

/** One frame at 30 fps, in ms. */
export const FLUSH_BUDGET = 1000 / 30;

/** A behavior's time in the current flush. */
interface Spent {
  readonly name: string;
  time: number;
  runs: number;
}

/** One registration's time, over all its instances. */
interface Tally extends Spent {
  listed: boolean;
}

interface FlushReport {
  readonly total: number;
  readonly reactions: number;
  readonly ui: number;
  /** At most three, slowest first. */
  readonly slowest: readonly Spent[];
}

/**
 * Times each flush. Allocation-free while a flush is within budget: tallies
 * are kept per registration and reset in place. A report adds them up by
 * behavior name: a behavior registered row by row is one registration per row.
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
      const byName = new Map<string, Spent>();
      for (const { name, time, runs } of this.listed) {
        const spent = byName.get(name);
        if (spent) {
          spent.time += time;
          spent.runs += runs;
        } else byName.set(name, { name, time, runs });
      }
      const slowest = [...byName.values()].sort((a, b) => b.time - a.time).slice(0, 3);
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
    if (!tally) this.tallies.set(instance.reg, (tally = { name: instance.reg.name, time: 0, runs: 0, listed: false }));
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

/** "40.0 ms (2 runs)"; the runs are left out for writes applied alone. */
const spent = (t: Spent) => `${ms(t.time)}${t.runs ? ` (${t.runs} ${t.runs === 1 ? "run" : "runs"})` : ""}`;

function overBudget(report: FlushReport): string {
  const slowest = report.slowest.map((t) => `"${t.name}" ${spent(t)}`).join(", ");
  return (
    `[form] A flush took ${ms(report.total)}, over the ${ms(FLUSH_BUDGET)} budget: ` +
    `${ms(report.reactions)} in reactions, ${ms(report.ui)} in UI listeners.` +
    (slowest ? ` Slowest behaviors: ${slowest}.` : "")
  );
}

// ============================================================
// DevTools tracks (https://developer.chrome.com/docs/devtools/performance/extension)
// ============================================================
const GROUP = "form-lib";
type Track = "flush" | "behaviors" | "async" | "registration";
type Color = "primary" | "secondary" | "secondary-light" | "secondary-dark" | "tertiary" | "tertiary-dark" | "error";

/** console.timeStamp with the extended arguments (Chrome 136+). */
type TimeStamp = (label: string, start: number, end: number, track: Track, group: string, color: Color) => void;

const where = (instance: ProbedInstance) => `${instance.reg.name} @${concretePath(instance.host, instance.host.node) || "<root>"}`;

class Tracks {
  private flushAt = 0;
  private runAt = 0;
  private registrationAt = 0;
  /** Runs in flight: their start and label. */
  private readonly flights = new Map<ProbedInstance, { start: number; label: string }>();

  private constructor(
    private readonly stamp: TimeStamp | undefined,
    private readonly measure: Performance["measure"] | undefined
  ) {}

  /** Undefined when neither API exists. */
  static detect(): Tracks | undefined {
    const stamp = typeof console.timeStamp === "function" ? (console.timeStamp.bind(console) as unknown as TimeStamp) : undefined;
    const measure = typeof performance.measure === "function" ? performance.measure.bind(performance) : undefined;
    return stamp || measure ? new Tracks(stamp, measure) : undefined;
  }

  flushStart(at: number): void {
    this.flushAt = at;
  }

  flushEnd(at: number, report: FlushReport | undefined): void {
    if (!report) return this.stamp?.("flush", this.flushAt, at, "flush", GROUP, "tertiary");
    this.detail("flush over budget", this.flushAt, at, "flush", "error", {
      tooltipText: `A flush took ${ms(report.total)}, over the ${ms(FLUSH_BUDGET)} budget`,
      properties: [
        ["Reactions", ms(report.reactions)],
        ["UI listeners", ms(report.ui)],
        ...report.slowest.map((t, i): [string, string] => [`${i + 1}. ${t.name}`, spent(t)]),
      ],
    });
  }

  runStart(at: number): void {
    this.runAt = at;
  }

  runEnd(instance: ProbedInstance, at: number, part: RunPart): void {
    if (!this.stamp) return;
    const label = where(instance);
    this.stamp(part === "apply" ? `${label} (apply)` : label, this.runAt, at, "behaviors", GROUP, "primary");
    if (part === "async") this.flights.set(instance, { start: this.runAt, label });
  }

  flightEnd(instance: ProbedInstance, at: number, cancelled: boolean): void {
    const flight = this.flights.get(instance);
    if (!flight) return;
    this.flights.delete(instance);
    const [label, color]: [string, Color] = cancelled ? [`${flight.label} (cancelled)`, "secondary-light"] : [flight.label, "secondary"];
    this.stamp!(label, flight.start, at, "async", GROUP, color);
  }

  registrationStart(at: number): void {
    this.registrationAt = at;
  }

  registrationEnd(at: number, describe: () => RegistrationChange): void {
    if (!this.measure) return;
    const { store, added, removed, owners } = describe();
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    this.detail(`registration @${store}`, this.registrationAt, at, "registration", "tertiary-dark", {
      tooltipText: `${plural(added.length, "behavior")} added, ${removed.length} removed, ${plural(owners.length, "combined key")} changed`,
      properties: [
        ...(added.length ? [["Added", added.join(", ")] as [string, string]] : []),
        ...(removed.length ? [["Removed", removed.join(", ")] as [string, string]] : []),
        ...owners.flatMap((o): [string, string][] => [
          [`${o.key} triggers`, o.triggers.join(", ")],
          [`${o.key} contributions`, [...o.parts, ...(o.more ? [`… and ${o.more} more`] : [])].join(", ") || "none: the key is back to its default"],
        ]),
      ],
    });
  }

  settled(store: BaseStore<any>, node: AnyNode, start: number, end: number): void {
    const at = concretePath(store._host, node) || "<root>";
    this.detail(`settle @${at}`, start, end, "async", "secondary-dark", {
      tooltipText: `settle() waited ${ms(end - start)} for the runs in flight inside ${at}`,
      properties: [],
    });
  }

  private detail(name: string, start: number, end: number, track: Track, color: Color, entry: { tooltipText: string; properties: [string, string][] }): void {
    this.measure?.(name, { start, end, detail: { devtools: { dataType: "track-entry", track, trackGroup: GROUP, color, ...entry } } });
  }
}

/** The probe createStore installs in dev. */
export class Diagnostics implements Probe {
  private readonly budget = new FlushBudget();
  private readonly tracks = Tracks.detect();

  flushStart(at: number): void {
    this.budget.flushStart(at);
    this.tracks?.flushStart(at);
  }
  reactionsEnd(at: number): void {
    this.budget.reactionsEnd(at);
  }
  flushEnd(at: number): void {
    const report = this.budget.flushEnd(at);
    if (report) console.warn(overBudget(report));
    this.tracks?.flushEnd(at, report);
  }
  runStart(_instance: ProbedInstance, at: number): void {
    this.budget.runStart(at);
    this.tracks?.runStart(at);
  }
  runEnd(instance: ProbedInstance, at: number, part: RunPart): void {
    this.budget.runEnd(instance, at, part);
    this.tracks?.runEnd(instance, at, part);
  }
  flightEnd(instance: ProbedInstance, at: number, cancelled: boolean): void {
    this.tracks?.flightEnd(instance, at, cancelled);
  }
  registrationStart(at: number): void {
    this.tracks?.registrationStart(at);
  }
  registrationEnd(at: number, describe: () => RegistrationChange): void {
    this.tracks?.registrationEnd(at, describe);
  }
  settled(store: BaseStore<any>, node: AnyNode, start: number, end: number): void {
    this.tracks?.settled(store, node, start, end);
  }
}
