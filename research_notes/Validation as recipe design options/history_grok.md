# Design history in the Grok conversation: what it says about where validation lives

Source for every finding below: `docs/01-grok-conversation.json`. It is a Grok chat titled "Shape-based React form library", with 58 messages from 09/24/2026 20:07 to 09/25/2026 15:04. Citations name the message index (`#n`), the speaker and the timestamp. "Author" means the human user (the form-lib author). "Grok" means the assistant. Quotes keep the author's original typos.

Link used for all citations: [conv](../../docs/01-grok-conversation.json)

Scope: the conversation spends most of its length on the shape, the meta typing, the lenses and the store. Validation comes up only as one kind of **behavior**. The author wrote 29 messages, all read in full. Grok's design proposals were read in full for #1–#23, #35, #37, #41, #47, #51, #53 and #55. The other Grok messages were searched for validation, error, behavior, rule and library-name terms.

---

## Q1. What were the author's founding principles and key features?

### Takeaway
The author founded the library on four ideas. First, a zod-like **shape** that is the single source of type inference. Second, **open, user-defined, inferred metadata** where "i don't hardcode within the library which meta fields exist". Third, **behaviors** applied on top of the shape, including validation. Fourth, **lenses and a subscribable store** for React. The strongest principle, and the one most often repeated, is that the library does not hard-code meta keys.

### Cited findings
- **Founding statement (author, #0, 09/24/2026 20:07):** "Core feature: shape. Shape - an ability to define a shape of the form in a zod-like style. Shape includes the type of the field as well as metadata that should exist for the field which is strictly typed and extendible with utility functions." — [conv #0](../../docs/01-grok-conversation.json)
- **Inference as the payoff (author, #0):** "This shape allows us to infer all the types for everyhting later. We can infer the form object, know whoch field has metadata of disabled, which has something else like visible or required." — [conv #0](../../docs/01-grok-conversation.json)
- **Behaviors as a layer applied after the shape (author, #0):** "After having the shape we can apply different behaviouslrs to the field such as some validations, calculations, maybe somethi else like an asymc check or something else." — [conv #0](../../docs/01-grok-conversation.json)
- **Identity, lenses and store (author, #0):** "the shape object gives you a unique identifier for any field in the form which allows use to create stores where the key is the reference to the property in the shape. Also we have an accessor built into any field . I mean like a lens…" and "there should be a binding to react with some store that has subscription mechanism and the lenses will allow us to subscribe to only some parts of the object." — [conv #0](../../docs/01-grok-conversation.json)
- **Implementation style (author, #0):** "Everything should be done in class way with maybe some hacks for typescript to hide unnecessary fields from the consumer." — [conv #0](../../docs/01-grok-conversation.json)
- **No hard-coded meta keys (author, #2, 09/24/2026 20:10):** "i wanted to have some way to create custom metadata of a specific field. Like for the fields that need two meta fields i put two, for the fields that need more - i put more. Like i don't hardcode within the library which meta fields exist. They should be dynamic and inferrable. So for example id some field needs a meta feeld called 'shouldDisplayHint' we just add it to metadata and we can handle it in the behavior" — [conv #2](../../docs/01-grok-conversation.json)
- **The shape does no runtime validation (author, #8, 09/24/2026 20:17):** "Let's get rid of the types, cause i just want 'object', 'array', 'field<Type>' to not force runtime validation. Generic field will allow use to infer the type of the form" — [conv #8](../../docs/01-grok-conversation.json). Grok's reply (#9) put it this way: "No parsing, no refinements, no runtime checks inside the shape itself. Validation, calculations, async checks, etc. stay in the behavior layer." — [conv #9](../../docs/01-grok-conversation.json)
- **Meta is a plain inferred object; builders only provide defaults (author, #10, 09/24/2026 20:19):** "let's keep the meta just any object that can be inferred but add a builder for default values, like 'meta.required().disabled()' that will use typescript to build a proper object with proper type." — [conv #10](../../docs/01-grok-conversation.json)
- **Strict typing preferred (author, #14, 09/24/2026 20:27):** "Okay, lets keep it strict." This replied to Grok's #13 argument for passing the shape to `defineMeta` for type-safe keys. — [conv #14](../../docs/01-grok-conversation.json)
- **Meta can attach to sections and arrays too (author, #48, 09/25/2026 13:13):** "can we do this for all the types of nodes so that you could attach some visible meta to the whole section or array" — [conv #48](../../docs/01-grok-conversation.json)
- **Other form libraries:** the author never names react-hook-form, Formik, TanStack Form, Final Form or any other form library in any of the 29 messages. Grok mentions them once, only to position the project: "It sits in the same design space as Zod + React Hook Form / Formik / TanStack Form, but with stronger emphasis on a single source-of-truth shape that carries both value types *and* extensible metadata…" (#1). It mentions TanStack once more to say the ecosystem moved away from `this`-based builders (#19). — [conv #1, #19](../../docs/01-grok-conversation.json)

### Inferences
- The "core has no opinion about what any metadata key means" principle in today's GLOSSARY.md goes straight back to the author's #2 statement. In the founding conversation, "extensible" meant **the set of meta keys is user-defined and inferred**. It did not mean "the core ships a fixed vocabulary that users can add to".
- The author named validation as one example in a list of behaviors ("validations, calculations, … an asymc check"), next to calculations. In the founding framing, validation is a use of the behavior mechanism, not a separate subsystem.

### Gaps
- The author stated no likes or dislikes about other form libraries in this conversation, so none can be reported from this source.
- The conversation never uses the words "core" and "recipe" in the current GLOSSARY sense. The core/recipe split came later.

---

## Q2. How did the author first picture validation and errors: keys, types, where rules are declared, async?

### Takeaway
The author pictured validation as a **behavior that subscribes to field changes and writes into a "default meta field 'error'"**. The author described `error` and `touched` as meta **defaults** on top of meta used "as a generic way to attach any value to a field". Rules were to be declared declaratively through a `defineBehavior(b => b.apply())` function. Behaviors, shape and meta would then be handed to form creation together. Async validation and conditional validation were explicit requirements. The author never specified the error's type or how multiple rules combine.

### Cited findings
- **The key quote on validation (author, #14, 09/24/2026 20:27):** "Another question how do we define behavior for the form. We need to think about many cases, for example, validation (it subscribed to the firld chages and runs some validation and puts an error if it exists to the default meta field 'error' (i think we can use meta as a generic way to attach any value to a field and have defaults like error, touched state)), some async validation, disablisng some field based on another field's value, calculation something based on another valude, applying different valudations based on some conditions like other values, etc." — [conv #14](../../docs/01-grok-conversation.json)
  - In this quote, validation (1) is a behavior, (2) is triggered by subscribing to field changes, (3) writes to a meta key named `error`, which the author calls "the default meta field", and (4) `error` and `touched` are "defaults" of a generic meta mechanism.
  - Required cases in the same message: sync validation, "some async validation", cross-field disabling, calculation, and "applying different valudations based on some conditions like other values" (conditional validation).
- **Declaring behaviors (author, #16, 09/24/2026 20:36):** "What if we create some function like 'defineBehavior' which will provide some 'b => b.apply()' or something for defining behavior for the form? And then later when the form is created we provide it all the things: shape, meta and behavior. What do you think? Do i miss something?" — [conv #16](../../docs/01-grok-conversation.json)
- **Reusable behavior functions without passing `b` around (author, #18, 09/24/2026 20:39):** "What do you think about using custom this with context? This will allow creating functions without drilling the 'b' to every reusable function." — [conv #18](../../docs/01-grok-conversation.json). Grok advised against it (see Q4). The author replied "Yes" (#20) to Grok's offer of a fluent `defineBehavior` plus reusable helpers such as `required` and `disableWhen`. — [conv #19, #20](../../docs/01-grok-conversation.json)
- **Async is a founding requirement (author, #0 and #14):** "maybe somethi else like an asymc check" (#0); "some async validation" (#14). — [conv #0, #14](../../docs/01-grok-conversation.json)
- **Grok's proposal for how validation writes errors (#15, 09/24/2026 20:27):** a behavior is `{ id, deps, writes?, run?, runAsync?(ctx, signal), when?: "change" | "blur" | "submit" | "manual", order? }`. "Simple required" is expressed as `setMeta(field, { error: "Required" })`. Async unique check "writes `validating` + `error`". Cross-field password match "writes error on `confirm`". "Form-level canSubmit" is "form-scoped behavior that reads all `error` + `validating` meta". — [conv #15](../../docs/01-grok-conversation.json)
- **Grok's fluent builder and helpers (#17, #21):** `defineBehavior(b => b.deps(...).on(...).async().debounce(300).when(...).apply(fn))`. `required(field, message)` calls `setMeta(field, { error: empty ? message : undefined })`. `uniqueEmail(field, check)` sets `{ validating: true }` and then `{ error: ok ? undefined : "Email already taken", validating: false }` with an AbortSignal. Behaviors are passed as a plain array: `createForm({ shape, meta, behaviors })`. — [conv #17, #21](../../docs/01-grok-conversation.json)
- **Error typing (Grok only, #37, 09/24/2026 22:46):** Grok's "conventional meta keys" table gives `error: string | undefined` ("Validation message"), `errors: string[]` ("Multiple messages"), `validating: boolean` ("Async validation in progress") and `required: boolean` ("Used by validation behaviors"). It adds: "Behaviors will read/write these keys; the meta system itself stays completely open." — [conv #37](../../docs/01-grok-conversation.json). The author never responded to or confirmed this table.
- **Static meta versus live meta (Grok, #37/#47/#49/#51):** "It does **not** run validation. It does **not** hold the live state (`error`, `touched`, etc. at runtime live in the **store**)" (#37). Later: "Static vs live meta | Static on node, live in store" (#51). — [conv #37, #51](../../docs/01-grok-conversation.json)
- **Per-array-item errors (author and Grok, #54/#55, 09/25/2026 14:59):** The author said: "for each substore we should have it's own registry cause each array item should have it's own meta copy for the specific item." Grok replied: "each array item can have independent `error`, `touched`, `validating`, etc. for the same field shape." — [conv #54, #55](../../docs/01-grok-conversation.json)
- **Array-level error (Grok, #57, 09/25/2026 15:04):** "Array node itself can have meta (`maxItems`, `error` for the whole list…)." — [conv #57](../../docs/01-grok-conversation.json)

### Inferences
- The author's phrase "the default meta field 'error'" can be read two ways. (i) The library ships `error` as a built-in default key, which fits option (a). (ii) `error` is the conventional name that validation behaviors write to by default, which fits (b) or (c). The parenthetical "use meta as a generic way to attach any value to a field and have defaults like error, touched state" puts `error` in the same category as `touched`. That supports reading it as a *default convention on top of a generic mechanism*, not a key the core reserves. It is still the only place where the author names a specific key the library should have by default. Of everything in this conversation, it gives option (a) its strongest support.
- The author's "defineBehavior … b => b.apply()" plus "when the form is created we provide it all the things" is the direct ancestor of today's `defineBehaviors(shape, b => b.add(...))`. The requirement that rules be declared as plain data before React goes back to #16.

### Gaps
- The author never specified the error's **type**: string, a typed union, a list, or per-rule identity. Only Grok proposed `string | undefined` and `string[]`, and the author never confirmed it.
- The author never said whether validation runs on change, blur or submit. Grok proposed `on: "change" | "blur" | "submit" | "manual"`.
- The author never distinguished field-level from form-level rules. Grok's catalogue in #15 does, but the author did not engage with it.

---

## Q3. Does anything say whether validation should be built into the core or pluggable and user-defined?

### Takeaway
All the evidence points toward **validation as one use of a generic behavior mechanism, not a privileged core subsystem**. The author listed validation next to calculation and disabling as a "behavior". The author insisted the library does not hard-code meta keys. Grok repeatedly described `error` as a "conventional" or "well-known" key and "not hard-coded in the core". The one counterweight is the author calling `error` "the default meta field". Nobody in the conversation discussed a dedicated validation layer or a single writer that owns `error`.

### Cited findings
- **Validation as a peer of other behaviors (author, #0, #14):** "apply different behaviouslrs to the field such as some validations, calculations, …" (#0); "how do we define behavior for the form … for example, validation …, some async validation, disablisng some field …, calculation …" (#14). — [conv #0, #14](../../docs/01-grok-conversation.json)
- **No hard-coding of meta keys (author, #2):** "i don't hardcode within the library which meta fields exist. They should be dynamic and inferrable." — [conv #2](../../docs/01-grok-conversation.json)
- **Grok echoing the author (#3, 09/24/2026 20:10):** "The library should **not** hard-code a fixed set of meta keys (`disabled`, `visible`, `required`, etc.). Those are just convenient defaults or common utilities." and "Keep common helpers (`required()`, `disabled()`, `visible()`, `label()`, …) as pure functions that return partial metadata objects. They are convenience, not built-in." — [conv #3](../../docs/01-grok-conversation.json)
- **Grok on `error` specifically (#15, 09/24/2026 20:27):** "`error`, `touched`, `dirty`, `disabled`, `visible`, `loading`, `warning`, etc. are just conventional keys that the library (or the user) can read/write. Nothing is hard-coded in the core — they are just well-known names." — [conv #15](../../docs/01-grok-conversation.json)
- **Grok: validation helpers use the same extension point as user code (#15):** "Reusable behavior factories → library and application code share the same extension point." — [conv #15](../../docs/01-grok-conversation.json)
- **Grok: plumbing behaviors are opt-in factories (#17):** for touched, dirty and visited: "Provide them as standard `defineBehavior` factories that users can opt into or that `createForm` adds by default". — [conv #17](../../docs/01-grok-conversation.json)
- **Author's counterweight (#14):** "puts an error if it exists to the default meta field 'error' … have defaults like error, touched state". — [conv #14](../../docs/01-grok-conversation.json)

### Inferences
- Measured against today's options: the founding conversation lines up with **option (c)**. Validation is built from behaviors, `error` is a conventional name, and helpers like `required(field)` are ordinary functions on the same extension point as user code. It lines up less well with **(a)**, where the core reserves `error`. The author's own principle is "i don't hardcode within the library which meta fields exist", and (a) is an exception to it. The "default meta field 'error'" phrase is the only textual hook for (a). It reads more naturally as "the key validation writes to by default" than as a reserved core name.
- **Option (b)**, where the core validation layer lets the recipe name the key, is not discussed. It is compatible with the "no hard-coded keys" principle. But it keeps a validation-specific subsystem in the core, and the founding conversation never pictured one.
- The present-day `src/validation.ts`, a per-field queue behavior that is the only writer of `error`, has **no precedent** in this conversation. It was introduced later, most likely to fix the multi-writer conflict described in Q4.

### Gaps
- The author never explicitly addressed "built-in validation versus pluggable validation". The conclusion rests on how the author framed validation (as a behavior) plus the no-hard-coded-keys principle, not on a direct statement.

---

## Q4. Which design ideas were proposed and rejected, and why?

### Takeaway
Most of the rejected ideas concern the shape and meta layers: runtime types, the Zod-style meta schema, the separate meta registry, id-keyed maps and the flat values map. For behaviors, the one idea discussed and dropped was the author's `this`-context proposal, which Grok argued against. None of the rejections involved validation directly. However, the **multi-writer conflict on `error` was built into Grok's own examples and never noticed**.

### Cited findings

Rejected or replaced ideas, in chronological order:

1. **Zod-style runtime field types (`field.string()`, `z.string()`) were dropped for `field<T>()`**. The author: "Let's get rid of the types, cause i just want 'object', 'array', 'field<Type>' to not force runtime validation." (#8, 20:17) Reason: no runtime validation in the shape, type inference only. — [conv #8](../../docs/01-grok-conversation.json)
2. **A Zod-like meta schema builder (`meta.object({ required: meta.literal(true) … })`) was dropped for a plain inferred object plus a defaults builder**. The author first proposed a zod-like meta builder (#6: "what if we make the meta fields definition also a zod-like builder?"). The author then narrowed it to "keep the meta just any object that can be inferred but add a builder for default values" (#10). — [conv #6, #10](../../docs/01-grok-conversation.json)
3. **Custom `this` context for behavior helpers was discouraged by Grok, and the author went along**. The author proposed it to avoid "drilling the 'b' to every reusable function" (#18). Grok (#19, 20:39) answered: "Avoid custom `this` for the public behavior API." Its reasons: TypeScript friction, arrow functions have no `this`, "Explicit > implicit", testing and tree-shaking, and ecosystem direction. Grok recommended "a fluent builder that is passed explicitly (`b => b.deps(...).apply(...)`) or a pure config-object style", with reusable behaviors as "ordinary functions". The author replied "Yes" (#20). — [conv #18, #19, #20](../../docs/01-grok-conversation.json)
4. **Separate root `object()` and `form()` functions were merged** (author, #24: "Let's merge the root object function and the form function"). — [conv #24](../../docs/01-grok-conversation.json)
5. **`FieldKey` was renamed `id`** (author, #28: "Maybe it's better to call it id?"), then **ids were replaced by node-as-key** (author, #40: "instead of using ids as maps we use the whole nodes as keys for the map?"). — [conv #28, #40](../../docs/01-grok-conversation.json)
6. **A separate `defineMeta(shape, {...})` registry was abandoned** after type failures. The author reported: "Type { required:boolean;} is not assignable to type 'never'" (#38). Then: "We cannot use shapes as keys in objects" (#42). Then: "None of the approaches worked. … Maybe it's easier to put meta in the form definition layer or somehow else?" (#46). Grok's Option A was meta on the node via `field<string>().meta(...)` (#47). The author: "I like the option a" (#48). Reason: inference. — [conv #38–#48](../../docs/01-grok-conversation.json)
7. **A flat values map in the store was rejected in favour of lens-based substores** (author, #52, 09/25/2026 14:16): "Currently, it has values map, that's not what i wanted. Remeber that node has lens so i want to use the lenses to get some part of the form object." — [conv #52](../../docs/01-grok-conversation.json)
8. **Substores from arbitrary lenses were restricted to substores only for a node** (author, #56): "I think we should allow creating a substore only for a node. This will allow us to verify that the user tries to set a value in a valid substore". — [conv #56](../../docs/01-grok-conversation.json)

Behavior and validation proposals by Grok that the author neither accepted nor rejected explicitly:
- Behaviors "become **data** (serializable descriptions)" (#17). Explicit `deps` / `writes`, `on`, `order`, `debounce`, `when` guard (#17, #21). A central scheduler with topological ordering, cycle detection and AbortController cancellation (#15). A "conventional meta keys" table (#37). A catch-and-write `behaviorError` meta for failing behaviors (#17). — [conv #15, #17, #21, #37](../../docs/01-grok-conversation.json)
- The conversation ends (#57, 09/25/2026 15:04) before any behavior runtime was designed in detail. The store and substores were the last topic. — [conv #57](../../docs/01-grok-conversation.json)

**An unnoticed conflict in Grok's validation design (#21, 09/24/2026 20:47):** the example registers `required(userShape.email)` and `uniqueEmail(userShape.email, checkEmailApi)` as separate behaviors. Each one independently calls `setMeta(field, { error: … })`, and `required` writes `error: undefined` when the value is present. — [conv #21](../../docs/01-grok-conversation.json)

### Inferences
- In Grok's model, the two behaviors in #21 race on the same `error` key: whoever writes last wins, so `required` can erase `uniqueEmail`'s error. Neither party raised this. It is exactly the problem that today's per-field "queue" in `src/validation.ts` solves by being the single writer of `error`. It is also the problem option (c) must solve generically: several rules combined into one writer of a key. The founding design did not anticipate it, so the conversation gives no guidance on *how* to combine rules. It only shows that the naive "each rule is its own behavior that writes `error`" model was the starting point and does not work.
- The `this` discussion shows the author values **reusable rule and behavior functions** that stay easy to write. That supports rules as plain declarative helpers, such as `rule(...)` inside `b.add(...)`, over imperative registration.

### Gaps
- There is no record of the author deciding among Grok's scheduler features (ordering, `writes`, `on: blur/submit`). Their status in this conversation is "proposed, not confirmed".

---

## Q5. Are there requirements that favour or rule out options (a), (b) or (c)?

### Takeaway
No stated requirement **rules out** any option. The author's founding principle ("i don't hardcode within the library which meta fields exist") and framing (validation is one behavior among calculations and disabling) **favour (c)**. **(b)** is second, since it keeps the key user-named. **(a)** has one hook: the author's own words "the default meta field 'error'", which describe `error` together with `touched` as meta "defaults". Async validation, conditional validation, declarative definition before form creation, and independent per-array-item errors are requirements that any of the three must meet.

### Cited findings
- **For (b) and (c), against (a):** "i don't hardcode within the library which meta fields exist. They should be dynamic and inferrable." (author, #2) — [conv #2](../../docs/01-grok-conversation.json)
- **For (c):** validation is listed as a behavior next to "calculation", "disablisng some field" and "async validation" (author, #14). "apply different behaviouslrs to the field such as some validations, calculations…" (author, #0). — [conv #0, #14](../../docs/01-grok-conversation.json)
- **For (a), weakly:** "puts an error if it exists to the default meta field 'error' (i think we can use meta as a generic way to attach any value to a field and have defaults like error, touched state)" (author, #14). — [conv #14](../../docs/01-grok-conversation.json)
- **Grok also favoured the conventional-key reading:** "Nothing is hard-coded in the core — they are just well-known names." (#15) — [conv #15](../../docs/01-grok-conversation.json)
- **Declarative definition before the form exists (all options must meet this):** "some function like 'defineBehavior' which will provide some 'b => b.apply()' … later when the form is created we provide it all the things: shape, meta and behavior." (author, #16) — [conv #16](../../docs/01-grok-conversation.json)
- **Async must be supported (all options):** "an asymc check" (#0), "some async validation" (#14). — [conv #0, #14](../../docs/01-grok-conversation.json)
- **Conditional validation (all options):** "applying different valudations based on some conditions like other values" (author, #14). — [conv #14](../../docs/01-grok-conversation.json)
- **Per-item meta and errors in arrays (all options):** "each array item should have it's own meta copy for the specific item" (author, #54). — [conv #54](../../docs/01-grok-conversation.json)
- **Strict typing and inference throughout:** "lets keep it strict" (#14). The meta registry was abandoned because inference broke (#38–#48). — [conv #14, #46](../../docs/01-grok-conversation.json)
- **Meta keys are handled by behaviors, not by the library:** "if some field needs a meta feeld called 'shouldDisplayHint' we just add it to metadata and we can handle it in the behavior" (author, #2). — [conv #2](../../docs/01-grok-conversation.json)

### Inferences
- The author's #2 model has three parts: the user adds a meta key, a behavior gives it meaning, and the library knows nothing about it. That is the same pattern as core plus recipe. If you apply it to `error`, you get option (c): `error` is a key, and a validation recipe, meaning a behavior or behavior combinator, gives it meaning.
- Strict inference is a hard requirement throughout (#14, #38–#48). Under (b) or (c), the error key name and value type then need to flow into the field's inferred meta type. The history shows the author will redesign an API rather than give up inference (the `defineMeta` registry was dropped for this reason alone).
- Option (c) needs a way to combine many rules into the single writer of a key. That capability is **required** because of the conflict latent in Grok's #21 example. It is not an optional nicety.

### Gaps
- The author's view on typed errors (as opposed to string messages) is not recorded, so this source cannot say whether error typing should favour a recipe-named or recipe-typed key.
- Form-level versus field-level rule placement, and whether a cross-field rule writes to one target field or several, is only in Grok's catalogue (#15: "Cross-field password match … writes error on `confirm`"). The author did not specify it.
