import { useEffect, useState } from "react";

const REST_MS = 350;
const smooth = value => value * value * (3 - 2 * value);

function blend(first, second, fraction) {
  const eased = smooth(Math.min(1, Math.max(0, fraction)));
  const keys = new Set([...Object.keys(first || {}), ...Object.keys(second || {})]);
  return Object.fromEntries([...keys].map(key => [key, (Number(first?.[key]) || 0) * (1 - eased) + (Number(second?.[key]) || 0) * eased]));
}

export function anglesAtTime(frames, holdSeconds, elapsedMs) {
  const start = frames[0]?.angles || {};
  const target = frames[1]?.angles || start;
  const end = frames[2]?.angles || start;
  const holdMs = Math.max(0, Number(holdSeconds) || 0) * 1000;
  const moveMs = movementDurationMs(frames);
  const cycle = moveMs * 2 + holdMs + REST_MS;
  const time = ((elapsedMs % cycle) + cycle) % cycle;
  if (time < moveMs) return blend(start, target, time / moveMs);
  if (time < moveMs + holdMs) return target;
  if (time < moveMs * 2 + holdMs) return blend(target, end, (time - moveMs - holdMs) / moveMs);
  return end;
}

export function movementDurationMs(frames) {
  const start = frames[0]?.angles || {};
  const target = frames[1]?.angles || start;
  const end = frames[2]?.angles || start;
  const joints = new Set([...Object.keys(start), ...Object.keys(target), ...Object.keys(end)]);
  const travel = Math.max(0, ...[...joints].map(joint => Math.max(
    Math.abs((target[joint] || 0) - (start[joint] || 0)),
    Math.abs((target[joint] || 0) - (end[joint] || 0))
  )));
  return Math.min(2200, 1200 + Math.max(0, travel - 45) * 8);
}

export function useMovementPreview(frames, holdSeconds, playing) {
  const [angles, setAngles] = useState(null);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    let frameId;
    let lastFrame = 0;
    const started = performance.now();
    const tick = now => {
      if (now - lastFrame >= 16) {
        setAngles(anglesAtTime(frames, holdSeconds, now - started));
        lastFrame = now;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [frames, holdSeconds, playing]);
  return playing ? angles || frames[0]?.angles || {} : null;
}
