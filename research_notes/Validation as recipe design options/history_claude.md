# Validation design history in the Claude conversation ("Continuing previous work")

Source for every citation: `/home/andrey/projects/form-lib/docs/02-claude-conversations.json`, conversation "Continuing previous work", `chat_messages[N]`. Citations are written as `[#N role, timestamp](docs/02-claude-conversations.json)`. "human" = the author (Andrey). "assistant" = Claude. Author quotes are verbatim, typos included. All 40 human messages were read in full; the assistant text of every message was read. For the validation stages (#49, #51, #53), the code the assistant wrote was also checked.

Short timeline of the validation thread (details under the questions below):
- #19–#21: the assistant proposes one writer per target and a per-field `validate(field, [...])` combinator.
- #23: the assistant proposes combined meta keys ("combiners").
- #24: the author asks for a strict single writer instead.
- #25: the assistant agrees and asks whether validation should be "the one exception".
- #26: the author proposes the per-field **queue**.
- #32–#33: form-level state. Validation becomes runtime-owned.
- #34–#35: everything becomes opt-in. `validation()` is a *feature*, so the core does not have to treat the key name `error` as special.
- #37–#41: scenarios, the owned-key write rule, and `exclusive` split into a behavior plus rules.
- #49–#53: implementation. Rules are `RuleLike` objects, not behaviors. The queue is one internal "feature behavior" that hard-codes `"error"` and `"validating"`.
- #56–#61: React layer. Declarative rules come first, component rules go through `useBehaviors`, and React data enters through `useSync` into meta.

---

## Q1. Why was validation a separate layer with a per-field queue rather than ordinary behaviors?

### Takeaway
The queue exists to satisfy the one-writer-per-target rule, which the author asked for. Several rules on one field all want to write `error`. So the assistant made "rules aren't behaviors themselves", and the author supplied the queue idea: rules linked to the field, applied in order "till the first error". The layer was later hardened into a runtime-owned subsystem. The reasons were ordering (sync before async, no server call if a sync rule fails), async ownership (`validating`, abort, debounce), `when` semantics (a false guard skips a rule, and no active rule clears `error`), and the needs of submit (force-run, wait for pending checks, aggregate over rows). The assistant argued that plain behaviors could not express those submit needs. None of these arguments says a rule can't be a behavior in principle. They are all about many writers per key and about a submit/aggregate API that behaviors lacked at the time.

### Cited Findings
**Origin: the author's first intent (Grok era, re-read at #19).**
- The assistant summarised the author's original intent from the Grok thread: "behaviors cover validation, async checks, disabling based on other values, and calculations; they're defined with something like `defineBehavior`" — [#19 assistant, 2026-09-25T15:36](docs/02-claude-conversations.json).
- The author's own Grok words, as re-read in the #19 tool output (Grok USER 14): "validation (it subscribed to the firld chages and runs some validation and puts an error if it exists to the default meta field 'error' (i think we can use meta as a generic way to attach any value to a field and have defaults like error, touched state))". So validation started out as *a behavior that writes the `error` meta key*, with `error` as a "default" key — [#19 tool_result, quoting Grok user msg 14](docs/02-claude-conversations.json).

**First proposal: one owner of `error`, combined by the user (#19).**
- Point 8, "One writer per target": "Two behaviors writing the same field's `error` is the classic bug: one clears what the other set… the runtime rejects two owners of the same (node, value) or (node, meta key) at creation. Validation rules are therefore combined per field into a single owner of `error`: `validate(shape.lines.item.qty, [required(), min(1), max(99)])`" — [#19 assistant](docs/02-claude-conversations.json).
- Point 7 (async): "The runtime can also track pending runs, which gives a form-level 'validating' state for free." — [#19 assistant](docs/02-claude-conversations.json).

**Async and sync rules form one pipeline (#21).**
- On async validation: "The async rule usually has sync rules on the same field (required, format), and it shouldn't call the server if those already fail. Both kinds write `error`, so the async rule belongs in the same per-field validation pipeline, running last and only when the sync rules pass." Finding E: "Sync and async rules for a field form one pipeline that owns `error`." — [#21 assistant, 2026-09-25T15:52](docs/02-claude-conversations.json).
- Finding D: "Validators depend on meta, not just values (`required`, and possibly `min`/`max`)". The example is a behavior that writes `required`, which the validator then reads — [#21 assistant](docs/02-claude-conversations.json).

**Rules auto-collected, no manual wrapper (#23).**
- After the author asked for `required(form.name)`-style utilities (#22), the assistant dropped the manual `validate(field, [...])` wrapper: "validation rules shouldn't be separate owners of `error`. The runtime collects all rules for a field into that field's validation pipeline, in registration order, with async rules last and run only when the sync rules pass. This includes rules registered later by components. There's no need to wrap them in `validate(field, [...])` by hand." — [#23 assistant, 2026-09-25T16:14](docs/02-claude-conversations.json).

**Validation as the explicit exception to one writer (#25).**
- "With a strict single writer, `required(shape.name)` and `maxLength(shape.name, 50)` would conflict, since both write `name.error`. I'd keep the per-field pipeline from last time: rules aren't behaviors themselves, and the runtime turns all rules for a field into that field's single validation behavior, the only writer of its `error`. Do you want validation to be that one exception, or should users write a single validation behavior per field themselves?" — [#25 assistant, 2026-09-25T16:22](docs/02-claude-conversations.json).

**The author's queue idea (#26).**
- The author answered with the queue: "I did not fully get you response but i think that validation can be done with some hidden/meta field on a field or something. What i mean that if we call multiple validations on a single field that they create a queue that is linked to the field's reference and once we need to validate a value we just take the queue and apply validations till the first error." — [#26 human, 2026-09-25T16:58](docs/02-claude-conversations.json).
- The assistant accepted it and filled in the details. "The queue as a whole is the single writer of `error`, so the one-writer rule holds." It "lives in the behavior runtime, keyed by node… Meta holds only the result (`error`)". Its triggers are "the union of all its rules' triggers". Order: "Rules defined with the form come first, in definition order. Rules registered later by components are appended". Async: "Async rules always run after all sync rules, so a failing `required` never triggers a server call." — [#27 assistant, 2026-09-25T16:59](docs/02-claude-conversations.json).

**Why submit and form-level state pushed validation into the runtime (#32–#33).**
- The author raised the question: "form-level state is interesting, how to do it? cause when i you press submit all the validations should run, we should wait for all of them to finish and then check if we can go on. Let's think if it's possible to do with error-as-meta approach or if we have to introduce error/validation as first class node functionality… We need to thoroughly think about it" — [#32 human, 2026-09-25T17:38](docs/02-claude-conversations.json).
- The assistant's answer ("Could this be done purely with meta and behaviors? Almost, but it gets awkward in three places") — [#33 assistant, 2026-09-25T17:39](docs/02-claude-conversations.json):
  - "Aggregating over rows… a dependency on a set of fields that grows and shrinks… Our explicit, static dependencies don't express that well."
  - "Running validation on demand. Submit has to force validation to run now, regardless of triggers. Behaviors only run when their triggers change."
  - "Waiting… a promise over state spread across the whole tree. Behaviors can't return one."
- Conclusion: "So I'd make exactly these parts built into the runtime… The runtime owns every field's queue and knows which rules are pending. It gets an operation `validate(node)`…" Also: "`error`, `validating`, `dirty`, and `touched` stay meta keys… The runtime just becomes their owner and does the bookkeeping behaviors can't do." — [#33 assistant](docs/02-claude-conversations.json).
- The same message said async rules don't run on creation ("opening a form doesn't send one request per field; submit runs them"), and debounced runs start immediately during submit — [#33 assistant](docs/02-claude-conversations.json).

**`when` semantics differ for rules and behaviors (#32–#33).**
- The author asked for a guard: "If we treat hidden/disabled like any other meta fields we need to have some guard like `when` that will allow us to set conditional validation or something depending on the meta." — [#32 human](docs/02-claude-conversations.json).
- The assistant's rules — [#33 assistant](docs/02-claude-conversations.json):
  - "Guard references become triggers automatically."
  - "For validation, a rule whose guard is false is skipped. If no rule in the queue is active, `error` is cleared, so a hidden field doesn't keep an old error. For other behaviors, a false guard just means 'don't run', and their previous writes stay."
- This asymmetry means a guarded rule can't be modelled as a plain guarded behavior. A plain behavior keeps its last write; a rule must actively clear `error`.

**Scenario walkthrough (#37).**
- Written with `b.add(required(...))`, `b.add(asyncRule(...))` inside `defineBehaviors(shape, b => …)`. "The rules for `name` form its queue… The queue is the only writer of `name.error` and `name.validating`." — [#37 assistant, 2026-09-26T09:05](docs/02-claude-conversations.json).
- Origin rules for validation — [#37 assistant](docs/02-claude-conversations.json):
  - "Sync rules run for every origin. Validity is a property of the data, not of who wrote it."
  - "Async rules run only for user changes by default… The queue remembers which value its async rule last checked, so a programmatically set value is marked as *not yet checked*, and submit checks it."
- The author agreed: "About the open question: i agree with your statements about programmatically setting and others." — [#38 human, 2026-09-26T13:19](docs/02-claude-conversations.json).

**Final agreed decision (#43).**
- "Each field has a queue of rules, run in order until the first error, with async rules after the sync ones. The queue owns `error` and `validating`. Async runs get an abort signal and optional debounce…" — [#43 assistant, 2026-09-26T14:39](docs/02-claude-conversations.json).
- The author replied "Looks good" — [#42 human](docs/02-claude-conversations.json) — and then "Okay, let's go one by one" — [#44 human](docs/02-claude-conversations.json).

**Implementation: async behaviors deferred, rules as `RuleLike` (#49–#51).**
- Generic async behaviors were never built. Stage 3 made an async `run` an error: `throw new Error(\`Behavior "${reg.name}": async behaviors are not supported yet\`)`, with the note "Async runs are reported as an error for now. They come with validation in stage 4." — [#49 assistant code and text, 2026-09-27T19:44](docs/02-claude-conversations.json).
- Stage 4 implemented async only for rules. The file header of `validation.ts` reads — [#51 assistant, Write validation.ts, 2026-09-27T20:01](docs/02-claude-conversations.json):
  - "Rules: rule(target, check) and asyncRule(target, check) target nodes with the validation() feature. They are passed like behaviors (createStore({ behaviors }) / store.addBehavior(...))."
  - "Queue: all rules of one node form its queue… The queue is a single feature behavior – the only writer of `error` and `validating` – whose triggers are the union of its rules' triggers, guards, and the node's effective `visible` / `disabled`."
- In the runtime, rules are a separate type: `export type AnyBehavior = Behavior | RuleLike;` with `/** @internal Validation rules are handled by the validation layer (validation.ts). */ export interface RuleLike { readonly _rule: true; }`. Rule changes go through `RuleHooks.change(host, rules, "add"|"remove"): QueueChange`, "applied atomically with other registrations" — [#51 assistant code](docs/02-claude-conversations.json).
- The queue behavior builds its refs with the literal key names: `new MetaRef<string | undefined>(node, "error")` and `new MetaRef<boolean>(node, "validating")`. It is named `${node.path}#validation`. Async results are written back with origin `behavior:<path>#validation` in a new batch — [#51 assistant, validation.ts](docs/02-claude-conversations.json).
- The `validation()` feature marks the key: `error: metaKey<string | undefined>(undefined, { owner: "feature", aggregate: (e) => e !== undefined, data: { validation: true, ...options } })` plus `validating: metaKey(false, { owner: "feature", aggregate: (v) => v })`. The doc comment says "Rules (rule / asyncRule) can only target nodes with this feature." — [#51 assistant, features.ts edit](docs/02-claude-conversations.json).
- The rule target type is structural and hard-codes the names: `export type Validatable = ShapeNode<any, any> & { readonly _meta: { error: string | undefined; validating: boolean } };` — [#51 assistant, validation.ts](docs/02-claude-conversations.json).

**Layering as explained to the author (#58–#60).**
- The author was confused about the layering: "I got a bit lost. I thought we we talking about a builder pattern but now it's different… I thought `when` will be a part of the builder but looks like it's a function that handles everything somehow." — [#58 human, 2026-09-28T07:49](docs/02-claude-conversations.json).
- The assistant's clarification put rules on a separate but parallel base level: "`defineBehavior(config)` is the fully configurable base. `rule` / `asyncRule` are the base for validation. Utilities like `required`, `calculate`, and `exclusive` are built on those two." Also: "`defineBehaviors(shape, (b) => ...)`… returns a plain list, which is what `createStore` and `addBehavior` accept. So writing `rule(...)` directly or inside `b.add(...)` produces the same thing" — [#59 assistant, 2026-09-28T07:50](docs/02-claude-conversations.json).
- The author replied: "Okay, i think we've come to a common agreement" — [#60 human](docs/02-claude-conversations.json).

### Inferences
- Each argument has its own origin:
  - **One writer.** The author pushed this in #24. It is the root cause of the queue.
  - **Ordering and sync-before-async.** The assistant raised it in #21. It is a composition rule inside one writer.
  - **Stop at the first error.** The author specified it in #26.
  - **`when` clears `error`.** The assistant specified it in #33.
  - **Submit force-run, waiting, and aggregation.** The assistant argued in #33 that behaviors lacked these. Later the design generalised much of this: `countIn`/`collect` became generic subtree aggregates for any key with `aggregate`, and origins/debounce/abort were designed generically. Only async *behaviors* and "force run / wait" stayed validation-only.
- In code, the "separate layer" goes further than the design text. The design text says the queue is "a single feature behavior". In code, rules are not behaviors at all (`RuleLike`), async exists only for rules, and the key names `error`/`validating` are literals in validation.ts.
- Option (c) (validation as a recipe) would need four generic core mechanisms that the conversation built only for validation:
  - async behaviors with abort, debounce and "unchecked" state;
  - a force-run / settle operation;
  - clear-on-guard-false semantics;
  - a way for many contributions to become one writer.
- The #33 arguments are therefore a checklist for what (c) must supply generically.
- The author's first instinct (Grok) was that validation is just a behavior writing a default `error` key. The queue was the author's own answer to one-writer, not a wish for a special validation subsystem. The author's #32 question ("error-as-meta approach or… first class node functionality… We need to thoroughly think about it") shows he was open to either. It was the assistant that recommended runtime ownership.

### Gaps
- The author never explicitly compared "rule as behavior" with "rule as a separate kind". The phrase "rules aren't behaviors themselves" is the assistant's (#25). The author answered with the queue idea but never discussed that framing directly.
- The export has no discussion of rule order when many independent sources contribute (for example rules from different modules, or recipe vs. app). Order is "registration order" (#27) by assertion only.

---

## Q2. Why exactly one writer per target? Was combining multiple writers (reducer/merge) considered?

### Takeaway
Yes, combining was considered. The assistant proposed per-key "combiners" in #23: `disabled`/`visible`/`required` combined by any-of, and `error` as "first non-empty contribution, in registration order". The author reacted with interest but asked for a strict single writer ("force user to make one way graph"). The assistant agreed. Combiners were explicitly deferred "as an addition we could make later for specific keys", never rejected on principle. The queue is effectively a hard-coded combiner for `error`: first non-empty in registration order, sync before async. Later decisions softened one-writer in three ways:
- app code may write owned keys;
- opposite `when`/`otherwise` branches may share a target;
- inheritance of `disabled`/`visible` replaces multiple writers for form-wide modes.

### Cited Findings
**First statement of the rule (#19).**
- "Two behaviors writing the same field's `error` is the classic bug: one clears what the other set. So behaviors declare what they write, and the runtime rejects two owners… Declared writes also make it possible to explain, in dev mode, which behavior set a given error." — [#19 assistant](docs/02-claude-conversations.json).

**The combiner proposal (#23).**
- "The exclusive case shows a problem with the strict one-writer rule. `disabled` on `discount` might also be set by `sameAsShipping`, by a read-only mode, and by a component behavior. These are independent reasons… `error` has the same problem (validation versus server errors, case 16), and so does `visible`. My proposal: some meta keys have a combiner. Each behavior writes its own contribution, and the meta you read is the combination" — [#23 assistant, 2026-09-25T16:14](docs/02-claude-conversations.json).
- The table combined `disabled`, `visible` and `required` as any-of, and `error` as "the first non-empty contribution, in registration order" — [#23 assistant](docs/02-claude-conversations.json).
- Benefits listed: "Independent reasons stop interfering… Cleanup becomes automatic. Removing a behavior removes its contributions… Outside writers like server errors or the UI become ordinary contributors." — [#23 assistant](docs/02-claude-conversations.json).
- Costs listed: "more machinery in the meta layer, reading meta means combining its contributions (with caching), and the `error` rule depends on order." — [#23 assistant](docs/02-claude-conversations.json).

**The author's reply (#24).**
- "Take into account that we define not only behavior for field's value but also for field's metadata. And i like the principal that one behavior cannot run twice. But in this case we need build a smart tree of behaviors to call everything with the latest fields. Or is there another way to handle it? I think the idea to have some logic for calculating meta if there are multiple sources that say different things on the same field is interesting. But what do you think about prohibiting multiple writes to the same field/meta in a single run. Like we can try to force user to make one way graph, like make him write a single behavior for a single field this will get rid of this race condition. What do you think?" — [#24 human, 2026-09-25T16:21](docs/02-claude-conversations.json).

**The decision to go strict (#25).**
- "I agree, and it fits the ordering well. With exactly one writer per target, every edge is unambiguous, the graph is easy to check and to show in dev tools… and the result doesn't depend on who wrote last. It's also simpler than combiners. Strictly speaking, combiners had no race either… But they add a second concept to learn… So I'd start strict and treat combiners as an addition we could make later for specific keys, if practice demands it. Nothing else would have to change for that." — [#25 assistant, 2026-09-25T16:22](docs/02-claude-conversations.json).
- The costs the assistant listed for going strict — [#25 assistant](docs/02-claude-conversations.json):
  - "Multiple reasons must be merged by hand… utilities like `exclusive` should also exist as plain condition helpers usable inside a custom behavior."
  - "Component behaviors can't add a second writer… That will limit the React part."
  - "Built-in writers count too."
- One writer is also what makes the dependency ordering work. "Edges. If behavior A writes a target that behavior B triggers on or reads, A runs before B." The `writes` declarations "now become required rather than optional." — [#25 assistant](docs/02-claude-conversations.json).

**Ownership and the one-writer rule after #26.**
- Owners after #26 were: "The library's interaction layer… `touched`… The field's validation queue: `error`… The preset's default behavior: `dirty`… One user behavior: anything the user declared without an owner". Also: "Two presets owning the same key is an error… since it would break the one-writer rule." — [#29 assistant, 2026-09-25T17:10](docs/02-claude-conversations.json).
- Agreed summary item 4: "One writer per target. Each value and each meta key has at most one writer, checked at registration." — [#31 assistant](docs/02-claude-conversations.json).
- The author's reply to that summary ("I think we've come to a common ground on this topic, what do you think?") had come just before, in [#30 human](docs/02-claude-conversations.json).

**First softening: app code may write owned keys (#37–#39).**
- The assistant proposed: "owned keys can't be written by other behaviors, but can be written directly by application code (origin `program`). That write stays until the owner writes again. For `error`, the next validation run replaces the server error" — [#37 assistant](docs/02-claude-conversations.json).
- The author agreed ("i agree with your statements about programmatically setting and others") — [#38 human](docs/02-claude-conversations.json).
- The assistant recorded it as settled — [#39 assistant](docs/02-claude-conversations.json).

**Second softening: opposite branches (#35, #53).**
- "With `when(...).otherwise(...)`, the builder knows the two branches never run at the same time. Two behaviors writing the same target from opposite branches are then allowed" — [#35 assistant, 2026-09-26T08:57](docs/02-claude-conversations.json).
- It was implemented in stage 5 ("the only runtime change in this stage") — [#53 assistant](docs/02-claude-conversations.json).

**Third softening: inheritance (#41).**
- "Inheritance also solves a problem with the one-writer rule: a form-wide read-only mode is just `disabled` on the root. There's no need for a second writer on each field's `disabled`." — [#41 assistant, 2026-09-26T13:38](docs/02-claude-conversations.json).

**`exclusive` split because `error` belongs to queues (#41).**
- "Split it into two parts, because `error` can only be written by validation queues: A behavior that writes `disabled`… A validation rule added to each field's queue." — [#41 assistant](docs/02-claude-conversations.json).
- Implemented as "`exclusive` returns a behavior plus one rule per field" — [#53 assistant](docs/02-claude-conversations.json).

**Component duplicates and one writer (#57, #71).**
- The assistant flagged that "Duplicate behaviors writing the same target make the second registration throw" — [#57 assistant](docs/02-claude-conversations.json).
- The final solution was sharing by explicit key: "Without a key, rendering a component twice throws a one-writer error whose message suggests passing `{ key }`." — [#71 assistant](docs/02-claude-conversations.json).

### Inferences
- A mechanism that combines many contributions into one key's writer was designed (#23) and parked, not refuted. The assistant said explicitly that adding it later would need nothing else to change (#25). The author called it "interesting" (#24).
- The author's objection was about races and graph clarity ("force user to make one way graph"). A combiner that is *itself* the single writer satisfies that: the queue already is such a combiner, with first-error-wins as its reducer.
- A generic "collect contributions → one writer" core mechanism, instantiated by a validation recipe, would therefore be consistent with every stated author preference. It generalises the queue; it doesn't break the one-writer rule.
- Rules and the queue are the only place in the delivered design where many registrations target one key. Everywhere else the strict rule holds, apart from the three softenings above.

### Gaps
- The author never commented directly on the order-dependence of an `error` combiner ("first non-empty… in registration order"). The queue accepted the same order-dependence silently.
- The conversation never revisited whether `disabled` should get a combiner once component behaviors arrived. Inheritance and keyed sharing were used instead.

---

## Q3. The author's views on core vs. pluggable validation, error type, warnings / multiple error keys, and dynamic vs. declarative rules

### Takeaway
- **Core vs. pluggable.** The author consistently wanted opt-in, user-defined meta, and the library not hard-coding which meta keys exist. The assistant turned that into "features", explicitly so that the core would not treat the key name `error` as special. In code, though, the validation layer still hard-codes `"error"` and `"validating"`.
- **Error type.** It was left as `string | undefined`. The assistant raised string vs. list and i18n (message keys); the author never answered either.
- **Warnings / multiple error-like keys.** The author said nothing. The assistant raised a separate `serverError` key, which lost to "app code may write `error`".
- **Rule sources.** The author wanted rules defined up front via builder utilities, plus component-defined rules for cases that can't be declared beforehand. The agreed principle was "logic lives in the main behaviors; React data enters through meta keys".

### Cited Findings
**Not hard-coding meta, and opt-in.**
- Grok-era, author (re-read in #19): "i wanted to have some way to create custom metadata of a specific field… i don't hardcode within the library which meta fields exist. They should be dynamic and inferrable." — [#19 tool_result, quoting Grok user msg 2](docs/02-claude-conversations.json).
- The same Grok export also contains a Grok assistant proposal: "`error`, `touched`, `dirty`, `disabled`, `visible`, `loading`, `warning`, etc. are just conventional keys… Nothing is hard-coded in the core — they are just well-known names." This is Grok's proposal, not the author's — [#19 tool_result, Grok assistant msgs 15–19](docs/02-claude-conversations.json).
- The author's opt-in request: "My idea was to make everything opt-in. Like if you need a dumb field with no validation, no dirty state, nothing but value, you can just do `field()`, if you need some validation then you can add `field().meta({error:''})` or something like this. This can allow building super flexible form that you can fully define… Maybe we can improve the idea of default behavior or make meta fields more complex, not just a simple object, maybe we can create some interface for metadata that will allow providing a complex config/behavior to the field or something. Let's think deeper about it. Does my point make sense?" — [#34 human, 2026-09-26T08:56](docs/02-claude-conversations.json).

**The assistant's feature argument against a reserved `error` name (#35).**
- "Why a feature rather than `{ error: "" }`? With plain `{ error: "" }`, the runtime would have to treat the key name `error` as special. Then any field using `error` for its own purpose would suddenly get a validation queue, and nothing would say whether `error` should count toward 'the form is invalid'. The feature carries that setup explicitly, and the key stays an ordinary name. That also lets you write your own features the same way the built-in ones are written" — [#35 assistant, 2026-09-26T08:57](docs/02-claude-conversations.json).
- The same message: "This replaces the 'built into the store' framing from last time: the store provides the mechanisms, and nodes opt into them through meta." — [#35 assistant](docs/02-claude-conversations.json).
- The author's response to #35 was "Yes, it looks kinda like i wanted. But let's explore more with examples." — [#36 human, 2026-09-26T09:04](docs/02-claude-conversations.json).

**Typed `error` requirement and the `control()` preset (#26–#27).**
- The author wanted the type system to require the key: "we can create some basic preset for meta, let's call it `control()`… it gives it default meta fields for control, such as touched state, error state, then you can extend with anything that you want. And since everything is strictly typed when we try to bind `required()` to a field we can check that that field has `error` meta field that can have an error written to" — [#26 human](docs/02-claude-conversations.json).
- The assistant: "Every utility states in its signature which meta it needs: `required` needs `error`… A missing key is a compile error rather than a silent no-op at runtime." — [#27 assistant](docs/02-claude-conversations.json).

**Presets are fixed (#74–#75).**
- The author on presets: "Let's not allow overriding default control behavior cause that's the reason `control` exists - to provide default functionality" — [#74 human, 2026-09-28T09:04](docs/02-claude-conversations.json).
- The recorded alternative: "combine the individual features and declare your own key, e.g. `field().meta(validation(), touched(), { dirty: false })`" — [#75 assistant](docs/02-claude-conversations.json).

**Error type.**
- "An open detail is whether `error` is a single string or a list of errors." Raised by the assistant, never answered by the author — [#21 assistant](docs/02-claude-conversations.json).
- The key was implemented as `metaKey<string | undefined>` and rule checks return `string | undefined` — [#51 assistant, features.ts / validation.ts](docs/02-claude-conversations.json).
- i18n was raised by the assistant: "Translated messages. Rules declared at module level can't call `t()`. Either `error` holds message keys that are translated at display time, or the rules are registered in a component with `t` among their dependencies. Keys are simpler, and they survive a locale change without re-running anything." — [#57 assistant, 2026-09-28T07:42](docs/02-claude-conversations.json).
- The author's following messages (#58, #60, #62) don't address it — [#58/#60/#62 human](docs/02-claude-conversations.json).
- Utilities later accept "Messages can be strings or functions of the value" — [#53 assistant](docs/02-claude-conversations.json).

**Warnings, server errors, and multiple error-like keys.**
- In this conversation the author never mentions warnings. The only occurrences of "warning" are the Grok key list in the #19 tool output and unrelated uses such as "unsaved changes warning" and "dev warning" — [#19, #55, #57 assistant](docs/02-claude-conversations.json).
- Server errors — the assistant: "Server errors are written from outside the behavior system. If validation is the only allowed writer of `error`, server errors need their own key (`serverError`), or a rule that lets external writes through." — [#21 assistant](docs/02-claude-conversations.json).
- The "external writes allowed" branch won (#37–#39, see Q2).
- The author later: "Server errors are handled by the consumer, we just give the tools to set an error to some field." — [#56 human, 2026-09-28T07:40](docs/02-claude-conversations.json).
- The resulting helper is `resolvePath("lines[1].qty#error")` plus `store.set` — [#65 assistant](docs/02-claude-conversations.json).
- Error display is up to the consumer. The author: "Point E: this is totally on the consumers side, we just calculate all the states and if he needs he can show the error with any condition he wants." — [#62 human, 2026-09-28T08:01](docs/02-claude-conversations.json).

**Configurable base config with utilities on top (#22).**
- The author: "I think we should make the config for a behavior super configurable and on to of it we can create utilities that will compose a config, for example if we have some `required(form.name)` validation on the field, it automatically means that the dependency for the behavior is the field that is provided and a function to check if it's empty." — [#22 human, 2026-09-25T16:13](docs/02-claude-conversations.json).
- Here the author calls `required(...)` a *behavior* utility that composes a behavior config.

**Component-defined behaviors (#22, #56).**
- The author: "Take into account that later when we will work on the react part there's going to be a way to write some behavior in the component for the cases when it's not possible to write beforehands." — [#22 human](docs/02-claude-conversations.json).
- The author's component cases: "Let's think deeper about the behavior inside components. We need to figure out the cases which can appear and work from them. I can name a few now: there is some async request that returns max quantity that we need to support; (maybe this case can be declared in the main behavior but i don't know) if `internalDistribution` key selected then in `countryCode` we cannot put China or Japan and we should show an error if it's selected; depending on the provided props we put either one behavior/validation or the other." — [#56 human](docs/02-claude-conversations.json).
- Two of the author's three cases are validation cases. The third treats "behavior/validation" as interchangeable.

**Declarative first (#57, #59, #61).**
- The assistant's principles: "Logic lives in the main behaviors; React data enters through meta keys via `useSync`. The logic stays declarative and testable without React, and submit sees it even when the component isn't mounted." and "`useBehavior` is only for logic that comes from the component" — [#57 assistant](docs/02-claude-conversations.json).
- Examples were rewritten with the builder, e.g. `b.when([shape.distribution], (d) => d === "internalDistribution", (b) => { b.add(rule(shape.countryCode, …)) })`. The component hook takes the same builder: `useBehaviors((b) => { if (strict) b.add(pattern(shape.phone, E164)); else … }, [strict])` — [#59 assistant](docs/02-claude-conversations.json).
- The author: "Okay, i think we've come to a common agreement" — [#60 human](docs/02-claude-conversations.json).
- The agreed React summary: "Logic lives in the main behaviors wherever possible… `useBehaviors((b) => ..., deps)` uses the same builder as `defineBehaviors`." — [#61 assistant](docs/02-claude-conversations.json).

**Builder origin (#34–#35).**
- The author: "What do you think about using builder pattern? Maybe we can do it like `b.when((ctx)=>ctx.get(form.age)>18, b=>{})` . This will allow also creating some reusable utilities to apply some common behavior to different nodes." — [#34 human](docs/02-claude-conversations.json).
- The assistant required conditions to list their refs: `b.when([form.age], (age) => age < 18, …)` — [#35 assistant](docs/02-claude-conversations.json).

### Inferences
- The author's stated values point toward options (b) and (c):
  - "i don't hardcode within the library which meta fields exist";
  - everything opt-in;
  - "some interface for metadata that will allow providing a complex config/behavior to the field".
- Before the core/recipe split was articulated, the assistant had already argued in #35 against the core treating the key name `error` as special. The feature/`metaKey` mechanism was meant to carry validation's meaning (owner, aggregate, and later `data: { validation: true }`) instead of the name. The implementation drifted back to hard-coded names (#51). Option (a) would formalise that drift; options (b) and (c) would restore the #35 intent.
- The author's #22 phrasing ("`required(form.name)`… the dependency for the behavior is…") and #56 ("put either one behavior/validation or the other") show that he thinks of rules as behaviors. The rule/behavior split was an implementation consequence of one-writer, not an author preference.
- The error type was never settled by the author. `string | undefined` is an assistant default, so changing it (for example to a generic `E` chosen by a recipe) wouldn't overturn any recorded author decision.

### Gaps
- The author never took a position on warnings or on several error-like keys (e.g. `error` + `warning`) sharing a mechanism.
- The author never answered the string vs. list question or the i18n message-key question.
- The author never said whether validation belongs in the core or should be pluggable. The core/recipe framing doesn't appear in this conversation; only the opt-in/feature framing does.

---

## Q4. What did the author explicitly like, dislike, accept or reject? (quotes)

### Takeaway
The author accepted almost every assistant proposal with short agreements. The substantive author-originated positions relevant to validation are:
1. the strict single writer per field or meta key (#24);
2. the per-field validation queue, stopping at the first error (#26);
3. typed meta, with a `control()` preset that makes `required()` require `error` (#26);
4. `when` guards for conditional validation (#32);
5. everything opt-in, with meta entries that carry config or behavior (#34);
6. a builder with `when` and reusable utilities (#34);
7. component-defined rules for cases that can't be declared up front (#22, #56);
8. server errors and error display left to the consumer (#56, #62);
9. `control()` not overridable (#74).

The author disliked or rejected very little: only overriding presets, and the parse/format helper. He expressed confusion once, when the layering looked inconsistent (#58).

### Cited Findings
**Likes.**
- The one-writer rule and running each behavior once (full text in Q2): "i like the principal that one behavior cannot run twice"… "what do you think about prohibiting multiple writes to the same field/meta in a single run. Like we can try to force user to make one way graph" — [#24 human](docs/02-claude-conversations.json).
- Combiners got qualified interest, not rejection: "I think the idea to have some logic for calculating meta if there are multiple sources that say different things on the same field is interesting." — [#24 human](docs/02-claude-conversations.json).
- Treating hidden/disabled as ordinary meta: "If we treat hidden/disabled like any other meta fields we need to have some guard like `when` that will allow us to set conditional validation or something depending on the meta." — [#32 human](docs/02-claude-conversations.json).

**Proposals.**
- The queue, where the author proposed the mechanism himself — [#26 human](docs/02-claude-conversations.json).
- The `control()` preset and the typed `required()` → `error` check, also proposed by the author — [#26 human](docs/02-claude-conversations.json).
- Default behaviors for meta keys: "Maybe another feature that we can support is default behavior for meta? Or is it overkill? What i mean by that: if you add `touched` meta to the field it automatically attached default behavior… But if we do that we need to limit the default behavior to only the current field." — [#28 human, 2026-09-25T17:09](docs/02-claude-conversations.json).
- Opt-in and "interface for metadata that will allow providing a complex config/behavior" (full text in Q3) — [#34 human](docs/02-claude-conversations.json).
- The builder with `b.when` and reusable utilities (full text in Q3) — [#34 human](docs/02-claude-conversations.json).
- Cancellable async behaviors: "I think if we create an async behavior functionality that will pass a signal that will allow to cancel the requests it will solve the issues. Cause i think if you type and there is an async validation and you put a debounced callback to the async behavior then it will work as expected - run only after not inputting the field for some time" — [#32 human](docs/02-claude-conversations.json).
  - Note that the author said "async behavior functionality", which is generic. What was delivered is async *rules* only (see Q1).
- Behavior errors: "If behavior throws we should eat it and log out the error and not stop the form, what do you think?" — [#32 human](docs/02-claude-conversations.json).
- Closed meta: "Yes set meta accepts only the existing keys." — [#32 human](docs/02-claude-conversations.json).

**Acceptances.**
- The feature/key-definition design: "Yes, it looks kinda like i wanted. But let's explore more with examples." — [#36 human](docs/02-claude-conversations.json).
- Origin semantics for validation and writes by app code to owned keys: "i agree with your statements about programmatically setting and others." — [#38 human](docs/02-claude-conversations.json).
- Hidden/disabled/exclusive/row defaults, including `exclusive` as behavior plus rules: "Let's settle those" [#40 human](docs/02-claude-conversations.json), then "Looks good" [#42 human](docs/02-claude-conversations.json).
- Declarative-first and `useBehaviors` with the same builder: "Okay, i think we've come to a common agreement" — [#60 human](docs/02-claude-conversations.json).

**Consumer responsibility.**
- "Server errors are handled by the consumer, we just give the tools to set an error to some field." — [#56 human](docs/02-claude-conversations.json).
- "Handling disabled, visible, etc. is fully on the user." — [#56 human](docs/02-claude-conversations.json).
- "Point E: this is totally on the consumers side, we just calculate all the states…" — [#62 human](docs/02-claude-conversations.json).

**Rejections.**
- Overriding presets: "Let's not allow overriding default control behavior cause that's the reason `control` exists - to provide default functionality" — [#74 human](docs/02-claude-conversations.json).
- The parse/format helper: "We don't care about this case, it's consumer's job to write this hook so we ignore this issue." — [#58 human](docs/02-claude-conversations.json).

**Confusion.**
- "I got a bit lost. I thought we we talking about a builder pattern but now it's different. Also i think that we talked about a complex meta object with it's config but now you just write `{ maxQty: undefined as number | undefined }`. I thought `when` will be a part of the builder but looks like it's a function that handles everything somehow. I'm confused, did i miss something in our conversation/architecture/solution?" — [#58 human](docs/02-claude-conversations.json).
- This shows the author values a single consistent authoring model, with the builder and key definitions as the canonical way in.

### Inferences
- The author treats recipe-like presets (`control()`) as fixed bundles, and prefers building blocks you compose (`validation()`, `touched()`, …) over configuration knobs (#74–#75). That fits option (c): a validation recipe assembled from generic core pieces.
- The author asked for generic "async behavior functionality" (#32). What was delivered is async only inside validation. That gap supports (c)'s need for core async behaviors.

### Gaps
- The author's short agreements ("Looks good", "Let's settle those") approve whole assistant summaries. From them alone one can't tell which specific validation sub-decisions (e.g. async origins default, clearing on guard false) he examined closely.

---

## Q5. Ideas proposed and dropped that bear on options (a), (b), (c), or on combining many contributions into one key writer

### Takeaway
Seven ideas bear directly on the open question:
1. per-key combiners (#23), deferred;
2. the explicit `validate(field, [rules])` wrapper (#19), replaced by auto-collection;
3. a separate `serverError` key (#21), dropped;
4. `error` as a list (#21), never decided;
5. i18n message keys (#57), never decided;
6. "the runtime would have to treat the key name `error` as special", rejected in #35 in favour of features;
7. a manual per-field validation behavior written by the user, offered in #25 and superseded by the queue.

The feature capabilities (`owner`, `behavior`, `aggregate`, `inherit`, `reactive`, `keepOnReset`, `data`) are the existing hook points a validation recipe could use.

### Cited Findings
**1. Combiners** (see Q2): the assistant's decision was "start strict and treat combiners as an addition we could make later for specific keys, if practice demands it. Nothing else would have to change for that." — [#25 assistant](docs/02-claude-conversations.json).

**2. The explicit combinator wrapper.**
- `validate(shape.lines.item.qty, [required(), min(1), max(99)])` [#19 assistant](docs/02-claude-conversations.json).
- It was replaced by automatic collection: "There's no need to wrap them in `validate(field, [...])` by hand." [#23 assistant](docs/02-claude-conversations.json).
- Relevance: an explicit wrapper is a user-visible single writer built from many rules. That is one candidate shape for (c), but it loses cross-module and component appending unless the wrapper supports it.

**3. The user writes the single writer.**
- "Do you want validation to be that one exception, or should users write a single validation behavior per field themselves?" [#25 assistant](docs/02-claude-conversations.json).
- The author answered with the queue instead [#26 human](docs/02-claude-conversations.json).

**4. `serverError` as a second key.**
- "server errors need their own key (`serverError`), or a rule that lets external writes through." [#21 assistant](docs/02-claude-conversations.json).
- Dropped in favour of "application code can write them directly… stays until the owner writes again" [#39 assistant](docs/02-claude-conversations.json).

**5. Validation layer "built into the store" → feature opt-in.**
- #33 proposed "Validation, subtree aggregates, and initial values built into the store" [#33 assistant](docs/02-claude-conversations.json).
- #35 reframed it: "This replaces the 'built into the store' framing from last time: the store provides the mechanisms, and nodes opt into them through meta." [#35 assistant](docs/02-claude-conversations.json).

**6. Key-definition capabilities (#35–#39, #57–#59).**
- `interface MetaKeyDef<V> { default: V; owner?: "feature"; behavior?: (self) => Config; aggregate?: (value: V) => boolean; }`, and "Features are bundles of key definitions." [#35 assistant](docs/02-claude-conversations.json).
- Later additions: `reactive: false` [#39 assistant](docs/02-claude-conversations.json), `inherit` [#43/#45 assistant](docs/02-claude-conversations.json), `keepOnReset` [#57/#59 assistant](docs/02-claude-conversations.json).
- In stage 4, `data: { validation: true, ...options }` marks the `error` key so the validation layer can find it [#51 assistant](docs/02-claude-conversations.json).
- The capability table said each one "hooks into a mechanism we've already designed": `owner` → one-writer check, `behavior` → behavior runtime limited to its own node, `aggregate` → subtree counts [#35 assistant](docs/02-claude-conversations.json).

**7. User-defined features.**
- "That also lets you write your own features the same way the built-in ones are written", with an example `editCount` feature defined entirely through `metaKey(0, { owner: "feature", behavior: (self) => ({...}) })` [#35 assistant](docs/02-claude-conversations.json).

**8. Validation reading meta for rule parameters.**
- `required` "follows the field's `required` meta key when the field declares one" [#53 assistant](docs/02-claude-conversations.json).
- Reference limits: `max(line.qty, line.qty.maxQty)` [#59/#65 assistant](docs/02-claude-conversations.json).
- So rules already read other meta keys chosen per field. Only the output keys (`error`/`validating`) are fixed.

**9. Aggregates by key name.**
- `countIn(node, key)` and `collect(node, key)` take a key name. "`countIn`'s key is a plain string, so the compiler doesn't check that the key is actually counted." [#47 assistant](docs/02-claude-conversations.json).
- `useValue(countIn(shape, "error"))` is used for "3 errors" badges [#55 assistant](docs/02-claude-conversations.json).
- Form validity is therefore already "count of a key whose `aggregate` is true", a generic mechanism, rather than something validation-specific.

**10. Behaviors cannot express submit (#33)** — the three limitations in Q1: aggregation over growing row sets, on-demand forced run, and waiting on a promise.
- Of these, aggregation was later solved generically (`aggregate`, `countIn`, `collect`) [#47 assistant](docs/02-claude-conversations.json).
- On-demand forced run and waiting were kept validation-specific in `validate()`/`submit()` [#51 assistant](docs/02-claude-conversations.json).

**11. Async only for rules.**
- "async behaviors are not supported yet" (stage 3) [#49 assistant](docs/02-claude-conversations.json).
- Stage 4 added async only in the validation layer [#51 assistant](docs/02-claude-conversations.json).
- It was never revisited before the end of the conversation [#73 assistant, gap list](docs/02-claude-conversations.json).

### Inferences
- **For option (a), reserve `error`.** The conversation contains an explicit argument against it (#35): name-based specialness means any field using `error` for another purpose gets a queue, and the name alone doesn't say whether it counts toward invalidity. Features were created to avoid this. The author accepted features ("looks kinda like i wanted"). Option (a) goes against the #35 reasoning; option (b) matches it.
- **For option (b), the recipe names the key.** It is the smallest change toward the #35 intent. The validation layer already finds the key via `data: { validation: true }` and could read the key name from there, but it still hard-codes `"error"`/`"validating"` and `Validatable`.
- **For option (c), validation as a recipe.** The conversation supplies most of the parts:
  - generic origins, debounce and abort, designed generically though implemented only for rules;
  - generic aggregates (`aggregate`, `countIn`, `collect`);
  - feature-owned keys (`owner: "feature"`);
  - per-node default behaviors;
  - atomic registration replacement;
  - builder guards.
- The missing pieces, all named in this conversation, are:
  - core async behaviors (the author's own #32 ask);
  - a core "force run and wait" (settle);
  - a "many contributions → one writer" mechanism. The #23 combiner is the recorded precedent, and the queue is its hard-coded instance.
- A "combiner" or "collector" key capability would let the validation recipe say: contributions to key K are ordered sync-then-async, the first non-empty wins, and a false guard counts as no contribution. The core's one-writer invariant would still hold, because the combiner is the writer. This matches the author's #24 concern (no races, one-way graph) and his #24 interest in "logic for calculating meta if there are multiple sources".

### Gaps
- The export has no assistant or author analysis of how a combiner would interact with dependency ranking. For example, is each contribution a node in the graph, or only the combined writer? The #25 remark "Nothing else would have to change" is only an assertion.
- Nothing in the export discusses reusing the combiner idea for `validating` / pending. Pending was derived from queue state (`running`/`timer`), not from a key combiner.
- Whether the current repo's `src/validation.ts` still matches the #51 code wasn't checked here; the scope was this file only.
