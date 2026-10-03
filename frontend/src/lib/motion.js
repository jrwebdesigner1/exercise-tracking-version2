const LANDMARKS = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, foot: 31 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, foot: 32 },
};
const TRACKING_GAP_MS = 300;
const STABLE_GRACE_MS = 250;

export const POSE_EDGES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32],
];

const subtract = (a, b) => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = vector => { const length = Math.hypot(...vector); return length > 1e-6 ? vector.map(value => value / length) : null; };
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });

function bodyAxes(world) {
  if (!world?.[11] || !world?.[12] || !world?.[23] || !world?.[24]) return null;
  const lateral = normalize(subtract(world[11], world[12]));
  const down = normalize(subtract(midpoint(world[23], world[24]), midpoint(world[11], world[12])));
  if (!lateral || !down) return null;
  const anterior = normalize(cross(down, lateral));
  return anterior ? { lateral, anterior } : null;
}

function signedBend(proximal, distal, preferredDirection) {
  const first = normalize(proximal);
  const second = normalize(distal);
  if (!first || !second) return null;
  const toward = normalize(preferredDirection.map((value, index) => value - first[index] * dot(preferredDirection, first)));
  if (!toward) return null;
  return Math.atan2(dot(second, toward), dot(second, first)) * 180 / Math.PI;
}

function visible(points, indices) {
  return indices.every(index => points[index] && (points[index].visibility ?? 1) >= .55);
}

function findHandIndex(hands, wrist) {
  if (!wrist || !hands?.length) return -1;
  return hands.map((hand, index) => ({ index, distance: Math.hypot(hand[0].x - wrist.x, hand[0].y - wrist.y) }))
    .filter(item => item.distance < .20).sort((a, b) => a.distance - b.distance)[0]?.index ?? -1;
}

function jointAngle(name, pose, world, hands, handWorld, axes, movementPlane) {
  const [side, kind] = name.split("_");
  const ids = LANDMARKS[side];
  if (!ids || !axes || !world?.length) return null;
  const needed = kind === "wrist" ? [ids.elbow, ids.wrist] : kind === "ankle" ? [ids.knee, ids.ankle, ids.foot] : kind === "knee" ? [ids.hip, ids.knee, ids.ankle] : kind === "hip" ? [ids.shoulder, ids.hip, ids.knee] : kind === "elbow" ? [ids.shoulder, ids.elbow, ids.wrist] : [ids.shoulder, ids.elbow, ids.hip];
  if (!visible(pose, needed) || needed.some(index => !world[index])) return null;
  const anterior = axes.anterior;
  if (kind === "wrist") {
    const index = findHandIndex(hands, pose[ids.wrist]);
    const hand = handWorld?.[index];
    if (!hand?.[0] || !hand?.[9]) return null;
    return signedBend(subtract(world[ids.wrist], world[ids.elbow]), subtract(hand[9], hand[0]), anterior);
  }
  if (kind === "shoulder") {
    const direction = movementPlane === "sagittal" ? anterior : axes.lateral.map(value => value * (side === "right" ? -1 : 1));
    return signedBend(subtract(world[ids.hip], world[ids.shoulder]), subtract(world[ids.elbow], world[ids.shoulder]), direction);
  }
  if (kind === "elbow") return signedBend(subtract(world[ids.elbow], world[ids.shoulder]), subtract(world[ids.wrist], world[ids.elbow]), anterior);
  if (kind === "hip") return signedBend(subtract(world[ids.hip], world[ids.shoulder]), subtract(world[ids.knee], world[ids.hip]), anterior);
  if (kind === "knee") return signedBend(subtract(world[ids.knee], world[ids.hip]), subtract(world[ids.ankle], world[ids.knee]), anterior.map(value => -value));
  if (kind === "ankle") return signedBend(subtract(world[ids.ankle], world[ids.knee]), subtract(world[ids.foot], world[ids.ankle]), anterior);
  return null;
}

export function measurePose(poseResult, handResult, exercise) {
  const pose = poseResult?.landmarks?.[0];
  const world = poseResult?.worldLandmarks?.[0];
  if (!pose) return { valid: false, reason: "Step into the camera view.", points: null };
  const axes = bodyAxes(world);
  if (!axes) return { valid: false, reason: "Keep your body in the camera view.", points: pose };
  const required = Object.keys(exercise.roles).filter(name => exercise.roles[name] !== "observe");
  const angles = {};
  for (const joint of required) {
    const value = jointAngle(joint, pose, world, handResult?.landmarks, handResult?.worldLandmarks, axes, exercise.movementPlane);
    if (value === null || !Number.isFinite(value)) {
      return { valid: false, reason: joint.endsWith("wrist") ? "Show your forearm and hand clearly." : "Make sure the moving joints are visible.", points: pose };
    }
    angles[joint] = Math.round(value * 10) / 10;
  }
  const torsoPairs = [[11, 23], [12, 24]].filter(([shoulder, hip]) => visible(pose, [shoulder, hip]));
  if (!torsoPairs.length) return { valid: false, reason: "Keep your shoulder and hip in view.", points: pose };
  const shoulderCenter = {
    x: torsoPairs.reduce((sum, [shoulder]) => sum + pose[shoulder].x, 0) / torsoPairs.length,
    y: torsoPairs.reduce((sum, [shoulder]) => sum + pose[shoulder].y, 0) / torsoPairs.length,
  };
  const hipCenter = {
    x: torsoPairs.reduce((sum, [, hip]) => sum + pose[hip].x, 0) / torsoPairs.length,
    y: torsoPairs.reduce((sum, [, hip]) => sum + pose[hip].y, 0) / torsoPairs.length,
  };
  const center = { x: (shoulderCenter.x + hipCenter.x) / 2, y: (shoulderCenter.y + hipCenter.y) / 2 };
  const torso = Math.hypot(shoulderCenter.x - hipCenter.x, shoulderCenter.y - hipCenter.y);
  if (center.x < .20 || center.x > .80) return { valid: false, reason: "Move toward the center of the frame.", points: pose };
  if (torso < .10) return { valid: false, reason: "Move a little closer to the camera.", points: pose };
  if (torso > .58) return { valid: false, reason: "Move a little farther from the camera.", points: pose };
  return { valid: true, angles, center, scale: torso, points: pose, handPoints: handResult?.landmarks || [] };
}

export function jointProgress(exercise, angles, name) {
  const start = exercise.frames[0]?.angles[name] ?? 0;
  const target = exercise.frames[1]?.angles[name] ?? 0;
  const goal = Math.abs(target - start);
  const tolerance = exercise.rules.tolerance;
  const current = angles?.[name];
  const progress = current == null ? null : current * Math.sign(target - start);
  const lower = Math.max(5, goal - tolerance);
  const upper = goal + tolerance;
  return {
    name, goal, lower, upper, progress,
    percent: progress == null || goal < 5 ? 0 : Math.max(0, Math.min(100, progress / goal * 100)),
    atTarget: goal >= 5 && progress != null && progress >= lower && progress <= upper,
  };
}

export function newTracker(exercise) {
  return {
    exercise, phase: "calibrating", reps: 0, baselineFrames: [], baseline: null,
    baselineScale: null, startedAt: null, targetAt: null, lastTargetAt: null, startSeen: false,
    angles: {}, samples: [], lastTimeMs: 0, lastValidAt: null, lostAt: null,
    unstableAt: null, trackingVisible: false, message: "Hold your start position in view.",
  };
}

export function advanceTracker(state, measurement, timeMs) {
  const next = { ...state, samples: state.samples, baselineFrames: state.baselineFrames, lastTimeMs: timeMs };
  const required = Object.keys(state.exercise.roles).filter(name => state.exercise.roles[name] !== "observe");
  const active = required.filter(name => state.exercise.roles[name] === "active");
  const stable = required.filter(name => state.exercise.roles[name] === "stable");
  if (state.reps >= state.exercise.reps) return { ...next, phase: "complete", message: "Exercise complete. Save your session." };
  if (state.samples.length >= 2400) return { ...next, phase: "paused", message: "Session limit reached. End and save your session." };

  if (!measurement.valid) {
    if (next.baseline && next.samples.length < 2400) next.samples = [...next.samples, { timeMs, visible: false, angles: {} }];
    next.trackingVisible = false;
    next.lostAt ??= timeMs;
    if (!next.baseline || next.lastValidAt === null || timeMs - next.lastValidAt > TRACKING_GAP_MS) {
      next.message = measurement.reason;
      next.phase = next.baseline ? "paused" : "calibrating";
      next.startedAt = null;
      next.targetAt = null;
      next.lastTargetAt = null;
      next.startSeen = false;
      next.unstableAt = null;
      next.baselineFrames = [];
    } else {
      next.message = "Tracking briefly interrupted. Keep your position.";
    }
    return next;
  }

  if (next.lostAt !== null) {
    if (next.lastValidAt !== null && timeMs - next.lastValidAt > TRACKING_GAP_MS) {
      next.phase = next.baseline ? "paused" : "calibrating";
      next.startedAt = null;
      next.targetAt = null;
      next.lastTargetAt = null;
      next.startSeen = false;
      next.unstableAt = null;
    } else if (next.targetAt !== null) {
      const gap = timeMs - next.lostAt;
      next.targetAt += gap;
      if (next.unstableAt !== null) next.unstableAt += gap;
    }
    next.lostAt = null;
  }
  next.trackingVisible = true;
  next.lastValidAt = timeMs;

  if (!next.baseline) {
    next.baselineFrames = [...next.baselineFrames, measurement];
    if (next.baselineFrames.length < 12) {
      next.message = "Hold still while we find your start position.";
      return next;
    }
    if (required.some(name => Math.max(...next.baselineFrames.map(frame => frame.angles[name])) - Math.min(...next.baselineFrames.map(frame => frame.angles[name])) > 10)) {
      next.baselineFrames = next.baselineFrames.slice(-6);
      next.message = "Hold your start position still for a moment.";
      return next;
    }
    next.baseline = Object.fromEntries(required.map(name => [name, next.baselineFrames.reduce((sum, frame) => sum + frame.angles[name], 0) / next.baselineFrames.length]));
    next.baselineScale = next.baselineFrames.reduce((sum, frame) => sum + frame.scale, 0) / next.baselineFrames.length;
    next.baselineFrames = [];
    next.phase = "ready";
    next.startSeen = true;
    next.angles = Object.fromEntries(required.map(name => [name, 0]));
    if (next.samples.length < 2400) next.samples = [...next.samples, { timeMs, visible: true, angles: next.angles }];
    next.message = "Ready. Move gently toward the green target.";
    return next;
  }

  const scaleRatio = measurement.scale / next.baselineScale;
  if (scaleRatio < .65 || scaleRatio > 1.5) {
    next.phase = "paused";
    next.startedAt = null;
    next.targetAt = null;
    next.startSeen = false;
    next.unstableAt = null;
    next.message = scaleRatio < .65 ? "Move a little closer to the camera." : "Move a little farther from the camera.";
    if (next.samples.length < 2400) next.samples = [...next.samples, { timeMs, visible: false, angles: {} }];
    return next;
  }

  const angles = Object.fromEntries(required.map(name => [name, Math.round((measurement.angles[name] - next.baseline[name]) * 10) / 10]));
  next.angles = angles;
  if (next.samples.length < 2400) next.samples = [...next.samples, { timeMs, visible: true, angles }];
  const progress = Object.fromEntries(active.map(name => [name, jointProgress(state.exercise, angles, name)]));
  const startFrame = state.exercise.frames[0]?.angles || {};
  const returnFrame = state.exercise.frames[2]?.angles || startFrame;
  const startLimit = Math.max(5, Math.min(12, state.exercise.rules.tolerance));
  const towardTarget = name => progress[name].progress;
  const atStart = active.every(name => Math.abs(angles[name]) <= startLimit);
  const atReturn = active.every(name => Math.abs(angles[name] - ((returnFrame[name] ?? startFrame[name] ?? 0) - (startFrame[name] ?? 0))) <= startLimit);
  const atTarget = active.every(name => progress[name].atTarget);
  const steady = stable.every(name => Math.abs(angles[name]) <= state.exercise.rules.stable);

  if (steady && next.unstableAt !== null) {
    if (next.targetAt !== null) next.targetAt += timeMs - next.unstableAt;
    next.unstableAt = null;
  }

  if (!steady) {
    next.unstableAt ??= timeMs;
    if (timeMs - next.unstableAt >= STABLE_GRACE_MS) {
      next.phase = "ready";
      next.startedAt = null;
      next.targetAt = null;
      next.lastTargetAt = null;
      next.startSeen = false;
    }
    next.message = "Keep the supporting joint steady.";
  } else if (next.phase === "paused") {
    next.phase = "ready";
    next.startSeen = atStart;
    next.message = "Tracking resumed. Return to the start position.";
  } else if (next.phase === "ready") {
    if (atStart) next.startSeen = true;
    next.message = next.startSeen ? "Move gently toward the green target." : "Return to your start position first.";
    if (next.startSeen && !atStart && active.some(name => towardTarget(name) > startLimit)) {
      next.phase = "moving"; next.startedAt = timeMs;
    }
  } else if (next.startedAt !== null && timeMs - next.startedAt > (state.exercise.rules.maxTime * 2 + state.exercise.hold) * 1000) {
    next.phase = "ready";
    next.startedAt = null;
    next.targetAt = null;
    next.startSeen = false;
    next.message = "Try again at a comfortable pace.";
  } else if (next.phase === "moving") {
    next.message = active.some(name => towardTarget(name) > progress[name].upper)
      ? "Move back into the green target range." : state.exercise.rules.feedback || "Move a little further.";
    if (atTarget) { next.phase = "target"; next.targetAt = timeMs; next.lastTargetAt = timeMs; next.message = "Good. Hold this position."; }
  } else if (next.phase === "target") {
    if (atTarget) {
      next.lastTargetAt = timeMs;
      if (timeMs - next.targetAt >= state.exercise.hold * 1000) { next.phase = "returning"; next.message = "Return slowly to the start."; }
    } else if ((next.lastTargetAt ?? next.targetAt) - next.targetAt >= Math.max(0, state.exercise.hold * 1000 - 150)) {
      next.phase = "returning";
      next.message = "Return slowly to the start.";
      if (atReturn) {
        if (timeMs - next.startedAt >= state.exercise.rules.minTime * 1000) { next.reps += 1; next.message = "Nice work. One repetition complete."; }
        else next.message = "Move a little more slowly.";
        next.phase = "ready";
        next.startedAt = null;
        next.targetAt = null;
        next.lastTargetAt = null;
        next.startSeen = true;
      }
    } else if (atStart) {
      next.phase = "ready"; next.startedAt = null; next.targetAt = null; next.lastTargetAt = null; next.message = "Reach the target before returning.";
    } else {
      next.phase = "moving"; next.targetAt = null; next.lastTargetAt = null; next.message = "Hold the target position a little longer.";
    }
  } else if (next.phase === "returning" && atReturn) {
    if (timeMs - next.startedAt >= state.exercise.rules.minTime * 1000) { next.reps += 1; next.message = "Nice work. One repetition complete."; }
    else next.message = "Move a little more slowly.";
    next.phase = "ready";
    next.startedAt = null;
    next.targetAt = null;
    next.startSeen = true;
  }
  return next;
}
