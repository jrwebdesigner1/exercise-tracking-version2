"""Recount camera-derived exercise samples against the saved exercise definition."""

from fastapi import HTTPException


def analyze_session(exercise, samples):
    active = [joint for joint, role in exercise["roles"].items() if role == "active"]
    stable = [joint for joint, role in exercise["roles"].items() if role == "stable"]
    start, target = exercise["frames"][:2]
    return_frame = exercise["frames"][2] if len(exercise["frames"]) > 2 else start
    required = {
        joint: abs(target["angles"].get(joint, 0) - start["angles"].get(joint, 0))
        for joint in active
    }
    if not active or any(amount < 5 for amount in required.values()):
        raise HTTPException(422, "Exercise has no trackable movement")

    previous_time = -1
    valid = 0
    reps = 0
    phase = "ready"
    start_seen = False
    started_at = None
    target_at = None
    last_target_at = None
    last_valid_at = None
    lost_at = None
    unstable_at = None
    max_progress = 0.0
    tolerance = exercise["rules"]["tolerance"]
    stable_limit = exercise["rules"]["stable"]
    start_limit = max(5.0, min(12.0, tolerance))
    min_ms = exercise["rules"]["minTime"] * 1000
    max_ms = (exercise["rules"]["maxTime"] * 2 + exercise["hold"]) * 1000
    hold_ms = exercise["hold"] * 1000

    for sample in samples:
        if sample.timeMs <= previous_time:
            raise HTTPException(422, "Tracking timestamps must increase")
        previous_time = sample.timeMs
        if reps >= exercise["reps"]:
            continue
        if not sample.visible or any(joint not in sample.angles for joint in active + stable):
            if lost_at is None:
                lost_at = sample.timeMs
            if last_valid_at is None or sample.timeMs - last_valid_at > 300:
                phase, started_at, target_at, last_target_at = "ready", None, None, None
                start_seen = False
                unstable_at = None
            continue
        if lost_at is not None:
            if last_valid_at is not None and sample.timeMs - last_valid_at > 300:
                phase, started_at, target_at, last_target_at = "ready", None, None, None
                start_seen = False
                unstable_at = None
            elif target_at is not None:
                gap = sample.timeMs - lost_at
                target_at += gap
                if unstable_at is not None:
                    unstable_at += gap
            lost_at = None
        last_valid_at = sample.timeMs
        if any(not -180 <= value <= 180 for value in sample.angles.values()):
            raise HTTPException(422, "Tracking angle is outside the supported range")
        valid += 1
        steady = all(abs(sample.angles[joint]) <= stable_limit for joint in stable)
        if steady and unstable_at is not None:
            if target_at is not None:
                target_at += sample.timeMs - unstable_at
            unstable_at = None
        toward_target = {joint: sample.angles[joint] * (1 if target["angles"].get(joint, 0) >= start["angles"].get(joint, 0) else -1) for joint in active}
        progress = min(toward_target[joint] / required[joint] for joint in active)
        max_progress = max(max_progress, min(max(progress, 0), 2))
        at_start = all(abs(sample.angles[joint]) <= start_limit for joint in active)
        at_return = all(abs(sample.angles[joint] - (return_frame["angles"].get(joint, start["angles"].get(joint, 0)) - start["angles"].get(joint, 0))) <= start_limit for joint in active)
        at_target = all(max(5, required[joint] - tolerance) <= toward_target[joint] <= required[joint] + tolerance for joint in active)

        if not steady:
            if unstable_at is None:
                unstable_at = sample.timeMs
            if sample.timeMs - unstable_at >= 250:
                phase, started_at, target_at, last_target_at = "ready", None, None, None
                start_seen = False
        elif phase == "ready":
            if at_start:
                start_seen = True
            if start_seen and not at_start and any(toward_target[joint] > start_limit for joint in active):
                phase, started_at = "moving", sample.timeMs
        elif started_at is not None and sample.timeMs - started_at > max_ms:
            phase, started_at, target_at = "ready", None, None
            start_seen = False
        elif phase == "moving" and at_target:
            phase, target_at, last_target_at = "target", sample.timeMs, sample.timeMs
        elif phase == "target":
            if at_target:
                last_target_at = sample.timeMs
                if sample.timeMs - target_at >= hold_ms:
                    phase = "returning"
            elif (last_target_at or target_at) - target_at >= max(0, hold_ms - 150):
                phase = "returning"
                if at_return:
                    if sample.timeMs - started_at >= min_ms:
                        reps += 1
                    phase, started_at, target_at, last_target_at = "ready", None, None, None
            elif at_start:
                phase, started_at, target_at, last_target_at = "ready", None, None, None
            else:
                phase, target_at, last_target_at = "moving", None, None
        elif phase == "returning" and at_return:
            if sample.timeMs - started_at >= min_ms:
                reps += 1
            phase, started_at, target_at = "ready", None, None

    return {
        "reps": reps,
        "targetReps": exercise["reps"],
        "durationSeconds": round((samples[-1].timeMs - samples[0].timeMs) / 1000, 1),
        "validFrames": valid,
        "totalFrames": len(samples),
        "trackingCoverage": round(valid / len(samples), 2),
        "maxProgress": round(max_progress, 2),
    }
