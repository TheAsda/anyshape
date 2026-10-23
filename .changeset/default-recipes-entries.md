---
"anyshape": patch
---

The default recipes ship in the package, as two entries: `anyshape/recipes` (validation, rules, input state, visibility, disabling, value behaviors, submit and focus) and `anyshape/recipes/react` (`useControl` and the input adapters). They share the core of `anyshape` and `anyshape/react`, and `anyshape/recipes` imports no React.

```ts
import { form, object, field } from "anyshape";
import { control, submitting, required, handleSubmit } from "anyshape/recipes";
import { useControl } from "anyshape/recipes/react";
```

Every policy they hold is listed in `recipes/POLICIES.md`, shipped beside their `.ts` sources. To change a policy, copy `node_modules/anyshape/recipes/` into your project and switch every recipe import to the copy.
