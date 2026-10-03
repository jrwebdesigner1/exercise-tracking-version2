import assert from "node:assert/strict";
import test from "node:test";
import { advanceTracker, jointProgress, measurePose, newTracker } from "../src/lib/motion.js";

const exercise = {
  roles: { right_wrist: "active", right_elbow: "stable" },
  frames: [{ angles: { right_wrist: 0 } }, { angles: { right_wrist: 40 } }, { angles: { right_wrist: 0 } }],
  rules: { tolerance: 8, stable: 8, minTime: 1, maxTime: 6, feedback: "Move further." },
  hold: .4,
};

function reading(wrist, elbow = 0) {
  return { valid: true, angles: { right_wrist: wrist, right_elbow: elbow }, scale: .3 };
}

function calibrated() {
  let state = newTracker(exercise);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  assert.equal(state.phase, "ready");
  return state;
}

test("only a held target followed by a return counts", () => {
  let state = calibrated();
  for (const [time, wrist] of [[1300, 12], [1600, 38], [2100, 39], [2300, 21], [2600, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
  assert.equal(state.phase, "ready");
  assert.ok(state.samples.length >= 5);
});

test("an incomplete movement and lost tracking cannot count", () => {
  let state = calibrated();
  for (const [time, wrist] of [[1300, 12], [1600, 24], [2000, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 0);
  state = advanceTracker(state, { valid: false, reason: "Move into view." }, 2200);
  assert.equal(state.trackingVisible, false);
  state = advanceTracker(state, { valid: false, reason: "Move into view." }, 2400);
  assert.equal(state.phase, "paused");
  assert.equal(state.samples.at(-1).visible, false);
});

test("wrist tracking needs a visible hand and body", () => {
  assert.equal(measurePose({}, {}, exercise).valid, false);
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  pose[11] = { x: .4, y: .3, visibility: 1 };
  pose[12] = { x: .6, y: .3, visibility: 1 };
  pose[14] = { x: .6, y: .5, visibility: 1 };
  pose[16] = { x: .6, y: .7, visibility: 1 };
  pose[23] = { x: .4, y: .6, visibility: 1 };
  pose[24] = { x: .6, y: .6, visibility: 1 };
  assert.equal(measurePose({ landmarks: [pose], worldLandmarks: [pose] }, {}, exercise).valid, false);
  const hand = Array.from({ length: 21 }, () => ({ x: .6, y: .7 }));
  hand[9] = { x: .6, y: .82 };
  const handWorld = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  handWorld[9] = { x: 0, y: .12, z: 0 };
  assert.equal(measurePose({ landmarks: [pose], worldLandmarks: [pose] }, { landmarks: [hand], worldLandmarks: [handWorld] }, exercise).valid, true);
  pose[11].visibility = .1;
  pose[23].visibility = .1;
  assert.equal(measurePose({ landmarks: [pose], worldLandmarks: [pose] }, { landmarks: [hand], worldLandmarks: [handWorld] }, exercise).valid, true);
});

test("3D hand landmarks distinguish wrist flexion from extension", () => {
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  pose[11] = { x: .6, y: .3, visibility: 1 };
  pose[12] = { x: .4, y: .3, visibility: 1 };
  pose[14] = { x: .4, y: .5, visibility: 1 };
  pose[16] = { x: .4, y: .7, visibility: 1 };
  pose[23] = { x: .6, y: .6, visibility: 1 };
  pose[24] = { x: .4, y: .6, visibility: 1 };
  const world = pose.map(point => ({ ...point }));
  Object.assign(world, {
    11: { x: .2, y: -.3, z: 0 }, 12: { x: -.2, y: -.3, z: 0 },
    14: { x: -.2, y: 0, z: 0 }, 16: { x: -.2, y: .3, z: 0 },
    23: { x: .2, y: .3, z: 0 }, 24: { x: -.2, y: .3, z: 0 },
  });
  const hand = Array.from({ length: 21 }, () => ({ x: .4, y: .7 }));
  const handWorld = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  handWorld[9] = { x: 0, y: .1, z: -.1 };
  const flexion = measurePose({ landmarks: [pose], worldLandmarks: [world] }, { landmarks: [hand], worldLandmarks: [handWorld] }, exercise);
  handWorld[9] = { x: 0, y: .1, z: .1 };
  const extension = measurePose({ landmarks: [pose], worldLandmarks: [world] }, { landmarks: [hand], worldLandmarks: [handWorld] }, exercise);
  assert.equal(flexion.valid, true);
  assert.ok(flexion.angles.right_wrist > 40);
  assert.ok(extension.angles.right_wrist < -40);

  const shoulder = { ...exercise, roles: { right_shoulder: "active" }, movementPlane: "sagittal" };
  world[14] = { x: -.2, y: 0, z: -.2 };
  const forward = measurePose({ landmarks: [pose], worldLandmarks: [world] }, {}, shoulder);
  world[14] = { x: -.2, y: 0, z: .2 };
  const backward = measurePose({ landmarks: [pose], worldLandmarks: [world] }, {}, shoulder);
  assert.ok(forward.angles.right_shoulder > 20);
  assert.ok(backward.angles.right_shoulder < -20);
  world[14] = { x: -.4, y: 0, z: 0 };
  const sideways = measurePose({ landmarks: [pose], worldLandmarks: [world] }, {}, { ...shoulder, movementPlane: "frontal" });
  assert.ok(sideways.angles.right_shoulder > 20);
});

test("an opposite-direction wrist bend does not count", () => {
  let state = calibrated();
  for (const [time, wrist] of [[1300, -12], [1600, -40], [2100, -40], [2300, -20], [2600, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 0);
  assert.ok(state.samples.some(sample => sample.angles?.right_wrist < 0));
});

test("a negative target only counts movement in its own direction", () => {
  const extension = { ...exercise, frames: [{ angles: { right_wrist: 0 } }, { angles: { right_wrist: -40 } }, { angles: { right_wrist: 0 } }] };
  let state = newTracker(extension);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  for (const [time, wrist] of [[1300, 12], [1600, 40], [2100, 40], [2300, 20], [2600, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 0);
  for (const [time, wrist] of [[3000, -12], [3300, -38], [3800, -39], [4000, -20], [4300, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
});

test("leaving the target resets the required hold", () => {
  let state = calibrated();
  for (const [time, wrist] of [[1300, 12], [1600, 38], [1800, 20], [2000, 39], [2200, 39], [2300, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 0);
});

test("long prescribed holds can finish and counting stops at the target reps", () => {
  const longHold = { ...exercise, hold: 7, reps: 1 };
  let state = newTracker(longHold);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  for (const [time, wrist] of [[1300, 12], [1600, 39], [5000, 39], [8700, 39], [9000, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
  const samples = state.samples.length;
  state = advanceTracker(state, reading(40), 9200);
  assert.equal(state.phase, "complete");
  assert.equal(state.samples.length, samples);
});

test("multiple therapist-defined joints must reach their own targets before a rep counts", () => {
  const bothSides = {
    ...exercise,
    reps: 2,
    roles: { right_shoulder: "active", left_shoulder: "active", right_elbow: "stable" },
    frames: [{ angles: { right_shoulder: 0, left_shoulder: 0 } }, { angles: { right_shoulder: 70, left_shoulder: -50 } }, { angles: { right_shoulder: 0, left_shoulder: 0 } }],
  };
  const frame = (right, left, elbow = 0) => ({ valid: true, angles: { right_shoulder: right, left_shoulder: left, right_elbow: elbow }, scale: .3 });
  let state = newTracker(bothSides);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, frame(0, 0), index * 100);
  for (const [time, right, left] of [[1300, 15, -12], [1600, 68, -25], [2100, 68, -25], [2400, 0, 0]]) state = advanceTracker(state, frame(right, left), time);
  assert.equal(state.reps, 0);
  for (const [time, right, left] of [[2800, 15, -12], [3100, 68, -49], [3600, 68, -49], [3900, 20, -15], [4200, 0, 0]]) state = advanceTracker(state, frame(right, left), time);
  assert.equal(state.reps, 1);
  assert.equal(jointProgress(bothSides, state.angles, "left_shoulder").atTarget, false);
  assert.equal(jointProgress(bothSides, { left_shoulder: -49 }, "left_shoulder").atTarget, true);
});

test("a slow valid rep can finish after the previous whole-rep timeout", () => {
  const slow = { ...exercise, hold: 1, rules: { ...exercise.rules, maxTime: 6 } };
  let state = newTracker(slow);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  for (const [time, wrist] of [[1300, 12], [5000, 39], [6100, 39], [7400, 20], [8100, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
  assert.equal(state.lastTimeMs, 8100);
});

test("returning just after the hold boundary counts the rep", () => {
  const held = { ...exercise, hold: 1 };
  let state = newTracker(held);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  for (const [time, wrist] of [[1300, 12], [1600, 39], [2500, 39], [2600, 20], [3000, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
});

test("rep completion follows the therapist's saved Return position", () => {
  const customReturn = { ...exercise, frames: [exercise.frames[0], exercise.frames[1], { angles: { right_wrist: 10 } }] };
  const run = ending => {
    let state = newTracker(customReturn);
    for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
    for (const [time, wrist] of [[1300, 12], [1600, 39], [2100, 39], [2300, 20], [2600, ending]]) state = advanceTracker(state, reading(wrist), time);
    return state;
  };
  assert.equal(run(10).reps, 1);
  assert.equal(run(0).reps, 0);
});

test("nonzero Start, Target, and Return positions use reference deltas", () => {
  const reference = { ...exercise, frames: [{ angles: { right_wrist: 20 } }, { angles: { right_wrist: 70 } }, { angles: { right_wrist: 25 } }] };
  let state = newTracker(reference);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(20), index * 100);
  assert.equal(jointProgress(reference, { right_wrist: 48 }, "right_wrist").atTarget, true);
  for (const [time, wrist] of [[1300, 32], [1600, 68], [2100, 68], [2300, 40], [2600, 25]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
});

test("supported joints on both sides measure flexion in the reference direction", () => {
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  Object.assign(pose, {
    11: { x: .6, y: .3, visibility: 1 }, 12: { x: .4, y: .3, visibility: 1 },
    13: { x: .6, y: .45, visibility: 1 }, 15: { x: .6, y: .58, visibility: 1 },
    14: { x: .4, y: .45, visibility: 1 }, 16: { x: .4, y: .58, visibility: 1 },
    23: { x: .6, y: .6, visibility: 1 }, 24: { x: .4, y: .6, visibility: 1 },
    25: { x: .6, y: .75, visibility: 1 }, 27: { x: .6, y: .9, visibility: 1 },
    31: { x: .6, y: .92, visibility: 1 },
    26: { x: .4, y: .75, visibility: 1 }, 28: { x: .4, y: .9, visibility: 1 },
    32: { x: .4, y: .92, visibility: 1 },
  });
  const rest = pose.map(point => ({ ...point }));
  Object.assign(rest, {
    11: { x: .2, y: -.3, z: 0 }, 12: { x: -.2, y: -.3, z: 0 },
    13: { x: .2, y: 0, z: 0 }, 15: { x: .2, y: .3, z: 0 },
    14: { x: -.2, y: 0, z: 0 }, 16: { x: -.2, y: .3, z: 0 },
    23: { x: .2, y: .3, z: 0 }, 24: { x: -.2, y: .3, z: 0 },
    25: { x: .2, y: .6, z: 0 }, 27: { x: .2, y: .9, z: 0 },
    31: { x: .2, y: .9, z: -.1 },
    26: { x: -.2, y: .6, z: 0 }, 28: { x: -.2, y: .9, z: 0 },
    32: { x: -.2, y: .9, z: -.1 },
  });
  for (const [joint, changed] of [
    ["right_elbow", { 16: { x: -.2, y: .3, z: -.2 } }],
    ["right_hip", { 26: { x: -.2, y: .6, z: -.2 } }],
    ["right_knee", { 28: { x: -.2, y: .9, z: .2 } }],
    ["right_ankle", {}],
    ["left_shoulder", { 13: { x: .4, y: 0, z: 0 } }],
    ["left_elbow", { 15: { x: .2, y: .3, z: -.2 } }],
    ["left_hip", { 25: { x: .2, y: .6, z: -.2 } }],
    ["left_knee", { 27: { x: .2, y: .9, z: .2 } }],
    ["left_ankle", {}],
  ]) {
    const world = rest.map(point => ({ ...point }));
    Object.assign(world, changed);
    const measured = measurePose({ landmarks: [pose], worldLandmarks: [world] }, {}, { ...exercise, roles: { [joint]: "active" } });
    assert.equal(measured.valid, true, joint);
    assert.ok(measured.angles[joint] > 20, joint);
  }
});

test("one missed camera frame does not erase a valid hold", () => {
  const held = { ...exercise, hold: 1 };
  let state = newTracker(held);
  for (let index = 0; index < 12; index++) state = advanceTracker(state, reading(0), index * 100);
  state = advanceTracker(state, reading(12), 1300);
  state = advanceTracker(state, reading(39), 1600);
  state = advanceTracker(state, reading(39), 1900);
  state = advanceTracker(state, { valid: false, reason: "Hand briefly hidden." }, 1980);
  assert.equal(state.phase, "target");
  assert.equal(state.trackingVisible, false);
  for (const [time, wrist] of [[2060, 39], [2700, 39], [2900, 20], [3400, 0]]) state = advanceTracker(state, reading(wrist), time);
  assert.equal(state.reps, 1);
});

test("a brief noisy stable joint recovers but sustained compensation rejects the rep", () => {
  const run = sustained => {
    let state = calibrated();
    state = advanceTracker(state, reading(12), 1300);
    state = advanceTracker(state, reading(39), 1600);
    state = advanceTracker(state, reading(39, 14), 1750);
    if (sustained) state = advanceTracker(state, reading(39, 14), 2050);
    for (const [time, wrist] of sustained ? [[2150, 39], [2600, 39], [2800, 20], [3300, 0]] : [[1850, 39], [2300, 39], [2600, 20], [3300, 0]]) state = advanceTracker(state, reading(wrist), time);
    return state.reps;
  };
  assert.equal(run(false), 1);
  assert.equal(run(true), 0);
});
