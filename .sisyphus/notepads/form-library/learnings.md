# Form Library - Learnings

## T3: Core Type Definitions

- **ts-expect API**: v1.3.0 exports `expectType`, `expectNever`, `TypeEqual`, `TypeOf`. There is NO `ts` export — the task spec's `ts<A, B>({})` pattern doesn't exist. Use `expectType<TypeEqual<A, B>>(true)` for exact type equality checks.
- **Zod v4 location**: `node_modules/zod/v4` exists. Zod is a peer dependency (not installed as devDep). The types file avoids importing from zod entirely — `FieldConfig.schema` is typed as `unknown` with a doc note that the real FieldSpec class will constrain it.
- **Conditional type discrimination**: InferForm/InferFormRaw use `extends FieldSpecLike<infer Valid, infer _Raw>` etc. The `FieldSpecLike` check must come BEFORE the generic `Record<string, unknown>` fallback, because interfaces with `kind` fields also match `Record<string, unknown>`.
- **ArraySpecLike nesting**: `ArraySpecLike<FieldSpecLike<string>>` correctly resolves through InferForm as: first match `ArraySpecLike<infer Item>` → `InferForm<FieldSpecLike<string>>` → match `FieldSpecLike<infer Valid>` → `string`. Result: `string[]`.
- **DeepPartial on arrays**: The array branch `T extends Array<infer U> ? Array<DeepPartial<U>>` keeps the array wrapper present (not optional) but makes items partial. This matches the spec: "array items are partial but array itself is present when provided".
- **Package manager**: npm fails due to `link:` protocol in dependencies. Use `bun` for installs.
