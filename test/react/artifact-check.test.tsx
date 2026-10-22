// ============================================================
// CI probe: fails on purpose so the failure-screenshot upload
// runs in the container. Removed in the next commit.
// ============================================================

import { test, expect } from "vitest";

test("temporary probe: fails so the screenshot upload runs", () => {
  expect(1).toBe(2);
});
