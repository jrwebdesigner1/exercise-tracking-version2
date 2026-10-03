import assert from "node:assert/strict";
import test from "node:test";
import { movementIssues, movementReady, newExercise } from "../src/lib/exercise.js";

test("saved positions explain why Continue is unavailable", () => {
  const exercise = { ...newExercise(), roles: { right_shoulder: "active" }, frames: [
    { name: "Start", angles: { right_shoulder: 90 } },
    { name: "Target", angles: { right_shoulder: 90 } },
    { name: "Return", angles: { right_shoulder: 90 } },
  ] };
  assert.equal(movementReady(exercise), false);
  assert.match(movementIssues(exercise)[0], /Right Shoulder.*5°/);
  exercise.frames[1].angles.right_shoulder = 130;
  assert.equal(movementReady(exercise), true);
  exercise.frames[2].angles.right_shoulder = 110;
  assert.match(movementIssues(exercise)[0], /Right Shoulder.*10°/);
});
