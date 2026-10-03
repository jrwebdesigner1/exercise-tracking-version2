import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anglesAtTime, movementDurationMs } from '../src/lib/useMovementPreview.js';

const frames = [
  { angles: { right_shoulder: 0 } },
  { angles: { right_shoulder: 90 } },
  { angles: { right_shoulder: 0 } },
];

test('preview moves smoothly through start, target, hold, and return', () => {
  const moveMs = movementDurationMs(frames);
  assert.equal(anglesAtTime(frames, 1, 0).right_shoulder, 0);
  assert.equal(anglesAtTime(frames, 1, moveMs / 2).right_shoulder, 45);
  assert.equal(anglesAtTime(frames, 1, moveMs).right_shoulder, 90);
  assert.equal(anglesAtTime(frames, 1, moveMs + 500).right_shoulder, 90);
  assert.equal(anglesAtTime(frames, 1, moveMs * 1.5 + 1000).right_shoulder, 45);
  assert.equal(anglesAtTime(frames, 1, moveMs * 2 + 1000).right_shoulder, 0);
});

test('larger joint moves play more slowly than wrist movements', () => {
  const wrist = [{ angles: { right_wrist: 0 } }, { angles: { right_wrist: 40 } }, { angles: { right_wrist: 0 } }];
  assert.equal(movementDurationMs(wrist), 1200);
  assert.ok(movementDurationMs(frames) > movementDurationMs(wrist));
});
