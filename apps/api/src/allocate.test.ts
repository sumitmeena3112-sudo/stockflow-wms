import test from "node:test";
import assert from "node:assert/strict";
import { allocate } from "./allocate.js";

test("takes from the fullest bin first", () => {
  const result = allocate(
    [
      { id: "a", available: 3 },
      { id: "b", available: 10 },
    ],
    4,
  );
  assert.deepEqual(result, [{ binId: "b", quantity: 4 }]);
});

test("splits across bins when one is not enough", () => {
  const result = allocate(
    [
      { id: "a", available: 3 },
      { id: "b", available: 5 },
    ],
    7,
  );
  assert.deepEqual(result, [
    { binId: "b", quantity: 5 },
    { binId: "a", quantity: 2 },
  ]);
});

test("returns null when stock is insufficient", () => {
  assert.equal(allocate([{ id: "a", available: 2 }], 3), null);
});

test("ignores empty bins", () => {
  assert.equal(allocate([{ id: "a", available: 0 }], 1), null);
});
