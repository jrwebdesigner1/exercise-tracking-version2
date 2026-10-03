import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, Square, Target, MoveUp, ScanLine } from "lucide-react";
import { advanceTracker, jointProgress, measurePose, newTracker, POSE_EDGES } from "@/lib/motion";
import { Button } from "./ui";
import { label } from "@/lib/exercise";

const JOINT_POINTS = {
  left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28,
};
const FOCUS_POINTS = { shoulder: "elbow", elbow: "wrist", wrist: "wrist", hip: "knee", knee: "ankle", ankle: "ankle" };
const pointVisible = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= .55;

function drawPose(canvas, measurement, exercise, state) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const points = measurement.points;
  if (!points) return;
  const width = canvas.width;
  const height = canvas.height;
  const size = Math.max(1, Math.min(width, height) / 720);
  const jointRoles = exercise.roles || {};
  const active = Object.keys(jointRoles).filter(name => jointRoles[name] === "active");
  const stable = Object.keys(jointRoles).filter(name => jointRoles[name] === "stable");
  const steady = stable.every(name => state.angles[name] != null && Math.abs(state.angles[name]) <= exercise.rules.stable);
  const circle = (point, radius, fill, stroke, strokeWidth = 2) => {
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius * size, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = strokeWidth * size; context.stroke(); }
  };

  // A light body line keeps the patient visible; only relevant joints get strong color.
  for (const [a, b] of POSE_EDGES) {
    if (!pointVisible(points[a]) || !pointVisible(points[b])) continue;
    context.beginPath();
    context.moveTo(points[a].x * width, points[a].y * height);
    context.lineTo(points[b].x * width, points[b].y * height);
    context.strokeStyle = "rgba(9, 28, 58, .75)";
    context.lineWidth = 7 * size;
    context.lineCap = "round";
    context.stroke();
    context.strokeStyle = "rgba(224, 246, 255, .95)";
    context.lineWidth = 3 * size;
    context.stroke();
  }

  const shown = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  for (const index of shown) {
    if (pointVisible(points[index])) circle(points[index], 6, "#0bc96f", "#fff", 2.5);
  }
  for (const name of stable) {
    const index = JOINT_POINTS[name];
    if (!pointVisible(points[index])) continue;
    const drifting = state.baseline && Math.abs(state.angles[name] || 0) > exercise.rules.stable;
    circle(points[index], 9, drifting ? "#fb923c" : "#13c8b1", "#fff", 3);
  }
  for (const name of active) {
    const [side, kind] = name.split("_");
    const index = JOINT_POINTS[`${side}_${FOCUS_POINTS[kind]}`];
    if (!pointVisible(points[index])) continue;
    let point = points[index];
    if (kind === "wrist") {
      const hand = measurement.handPoints?.find(candidate => candidate?.[0] && Math.hypot(candidate[0].x - point.x, candidate[0].y - point.y) < .20);
      if (hand?.[9]) {
        context.beginPath();
        context.moveTo(point.x * width, point.y * height);
        context.lineTo(hand[9].x * width, hand[9].y * height);
        context.strokeStyle = "#fff";
        context.lineWidth = 3 * size;
        context.stroke();
        point = hand[9];
      }
    }
    const movement = jointProgress(exercise, state.angles, name);
    const reached = state.trackingVisible && ["target", "returning"].includes(state.phase) && state.baseline && steady && movement.atTarget;
    circle(point, 21, "rgba(37, 99, 235, .12)", reached ? "#18cb7d" : "#3b93ff", 2);
    if (state.baseline && state.phase !== "paused") {
      context.beginPath();
      context.arc(point.x * width, point.y * height, 21 * size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * movement.percent / 100);
      context.strokeStyle = reached ? "#18cb7d" : "#ff911c";
      context.lineWidth = 5 * size;
      context.lineCap = "round";
      context.stroke();
    }
    circle(point, 13, "rgba(37, 99, 235, .18)", "#fff", 2);
    circle(point, 7, reached ? "#18cb7d" : "#ff911c", "#fff", 2.5);
  }
}

export default function LiveTracking({ exercise, mutate, onDone }) {
  const video = useRef(null);
  const overlay = useRef(null);
  const stream = useRef(null);
  const models = useRef({ pose: null, hand: null });
  const tracker = useRef(newTracker(exercise));
  const raf = useRef(null);
  const sessionStart = useRef(null);
  const saving = useRef(false);
  const finishRef = useRef(null);
  const autoSaveAttempted = useRef(false);
  const [stage, setStage] = useState("permission");
  const [snapshot, setSnapshot] = useState(() => newTracker(exercise));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const activeJoints = Object.entries(exercise.roles).filter(([, role]) => role === "active").map(([name]) => name);
  const stableJoints = Object.entries(exercise.roles).filter(([, role]) => role === "stable").map(([name]) => name);
  const movements = activeJoints.map(name => jointProgress(exercise, snapshot.trackingVisible ? snapshot.angles : {}, name));
  const stableGood = snapshot.trackingVisible && stableJoints.every(name => snapshot.angles[name] != null && Math.abs(snapshot.angles[name]) <= exercise.rules.stable);
  const targetPhase = ["target", "returning"].includes(snapshot.phase);
  const inTarget = targetPhase && movements.length > 0 && stableGood && movements.every(movement => movement.atTarget);
  const targetText = activeJoints.map(label).join(" and ") || "Moving joints";
  const stageNumber = snapshot.phase === "calibrating" || snapshot.phase === "paused" ? 1 : snapshot.phase === "target" ? 3 : snapshot.phase === "returning" ? 4 : 2;
  const trackingGood = stage === "tracking" && snapshot.trackingVisible && snapshot.phase !== "calibrating" && snapshot.phase !== "paused";
  const holdMs = Math.max(0, Number(exercise.hold) * 1000);
  const holdClock = Math.min(snapshot.trackingVisible ? snapshot.lastTimeMs : snapshot.lastValidAt ?? 0, snapshot.unstableAt ?? Infinity);
  const holdElapsedMs = snapshot.phase === "returning" ? holdMs : snapshot.phase === "target" && snapshot.targetAt != null ? Math.max(0, holdClock - snapshot.targetAt) : 0;
  const holdPercent = holdMs === 0 ? 100 : Math.min(100, holdElapsedMs / holdMs * 100);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  };

  useEffect(() => () => {
    stop();
    models.current.pose?.close();
    models.current.hand?.close();
  }, []);
  useEffect(() => { finishRef.current = finish; });

  const begin = async () => {
    setBusy(true);
    setError("");
    setStage("loading");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
      const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      models.current.pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/models/pose_landmarker_lite.task", delegate: "CPU" },
        runningMode: "VIDEO", numPoses: 1,
      });
      if (Object.keys(exercise.roles).some(name => name.endsWith("wrist"))) {
        models.current.hand = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/models/hand_landmarker.task", delegate: "CPU" },
          runningMode: "VIDEO", numHands: 2,
        });
      }
      tracker.current = newTracker(exercise);
      sessionStart.current = null;
      setSnapshot(tracker.current);
      setStage("tracking");
    } catch (problem) {
      stop();
      models.current.pose?.close();
      models.current.hand?.close();
      models.current = { pose: null, hand: null };
      setStage("permission");
      setError(problem?.name === "NotAllowedError" ? "Camera access was blocked. Allow camera access and try again." : `Tracking could not start: ${problem.message}`);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (stage !== "tracking" || !video.current || !stream.current) return;
    const camera = video.current;
    camera.srcObject = stream.current;
    camera.play().catch(() => {
      stop();
      models.current.pose?.close();
      models.current.hand?.close();
      models.current = { pose: null, hand: null };
      setStage("permission");
      setError("The camera could not play. Check its browser permission.");
    });
    let lastFrame = -1;
    let lastProcessed = -Infinity;
    const loop = () => {
      if (!video.current || !models.current.pose) return;
      const now = performance.now();
      if (camera.readyState >= 2 && camera.currentTime !== lastFrame && now - lastProcessed >= 80) {
        try {
          if (sessionStart.current === null) sessionStart.current = now;
          const timeMs = Math.round(now - sessionStart.current);
          const pose = models.current.pose.detectForVideo(camera, timeMs);
          const hand = models.current.hand?.detectForVideo(camera, timeMs);
          const measurement = measurePose(pose, hand, exercise);
          if (overlay.current && (overlay.current.width !== camera.videoWidth || overlay.current.height !== camera.videoHeight)) {
            overlay.current.width = camera.videoWidth;
            overlay.current.height = camera.videoHeight;
          }
          tracker.current = advanceTracker(tracker.current, measurement, timeMs);
          drawPose(overlay.current, measurement, exercise, tracker.current);
          setSnapshot(tracker.current);
          if (tracker.current.phase === "complete" && !autoSaveAttempted.current) {
            autoSaveAttempted.current = true;
            void finishRef.current?.(tracker.current.samples);
          }
          lastFrame = camera.currentTime;
          lastProcessed = now;
        } catch (problem) {
          setError(`Tracking paused: ${problem.message}`);
          stop();
          models.current.pose?.close();
          models.current.hand?.close();
          models.current = { pose: null, hand: null };
          setStage("permission");
          return;
        }
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [stage, exercise]);

  const recalibrate = () => {
    const previous = tracker.current;
    const timeMs = previous.samples.at(-1)?.timeMs || 0;
    tracker.current = { ...newTracker(exercise), reps: previous.reps, samples: [...previous.samples, { timeMs: timeMs + 1, visible: false, angles: {} }] };
    setSnapshot(tracker.current);
  };

  async function finish(samples = tracker.current.samples) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await mutate("/sessions", { method: "POST", body: { exerciseId: exercise.id, samples } }, "Session saved");
      stop();
      setResult(saved);
      setStage("complete");
    } catch (problem) { setError(`Session could not be saved: ${problem.message}. Try Save session again.`); }
    finally { setBusy(false); saving.current = false; }
  }

  if (stage === "complete") return <div className="tracking-complete"><span><Check size={30}/></span><h2>Session saved</h2><p>{result.reps} of {result.targetReps} repetitions counted from camera movement</p><small>{Math.round(result.trackingCoverage * 100)}% of frames had the required joints in view. Your therapist can review this result.</small><Button onClick={onDone}>Back to your plan</Button></div>;

  return <div className="tracking-layout">
    <div className="tracking-main">
      <div className="tracking-steps" aria-label="Exercise steps">{["Align body", "Follow target points", "Hold position", "Return"].map((item, index) => <div key={item} className={`tracking-step ${index + 1 === stageNumber ? "current" : ""} ${index + 1 < stageNumber ? "done" : ""}`}><span>{index + 1}</span><strong>{item}</strong></div>)}</div>
      <div className="tracking-camera">
        {stage === "tracking" ? <><video ref={video} autoPlay playsInline muted/><canvas ref={overlay}/><div className={`tracking-live-badge ${trackingGood ? "good" : "waiting"}`}><i/>{trackingGood ? "Your live tracking" : snapshot.phase === "paused" ? "Tracking paused" : "Finding your position"}</div><div className="tracking-camera-reps"><strong>{snapshot.reps}/{exercise.reps}</strong><span>Reps</span></div><div className="tracking-camera-guide"><ScanLine size={15}/>{snapshot.message}</div></> : <div className="tracking-camera-empty"><Camera size={35}/><strong>{stage === "loading" ? "Preparing movement tracking…" : "Ready when you are"}</strong><span>{stage === "loading" ? "Loading body and hand detection" : `Place your camera for the ${exercise.camera.toLowerCase()} view. Video is not saved.`}</span></div>}
      </div>
      {stage === "tracking" && <div className={`tracking-hold ${snapshot.phase === "target" || snapshot.phase === "returning" ? "active" : ""}`}><div><strong>{snapshot.phase === "returning" ? "Hold complete — return to start" : snapshot.phase === "target" ? "Hold the green points" : "Reach the green points"}</strong><span>{snapshot.phase === "target" ? `${Math.max(0, (holdMs - holdElapsedMs) / 1000).toFixed(1)}s remaining` : snapshot.phase === "returning" ? "Return to finish this rep" : "Hold, then return to count a rep"}</span></div><div className="tracking-hold-meter" role="progressbar" aria-label="Target hold" aria-valuenow={Math.round(holdPercent)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${holdPercent}%` }}/></div></div>}
      <div className="tracking-feedback-row"><div className={`tracking-feedback-card ${inTarget ? "success" : "action"}`}><span className="tracking-feedback-icon"><MoveUp size={19}/></span><div><strong>{snapshot.phase === "returning" ? "Return to start" : inTarget ? "Target reached" : snapshot.phase === "calibrating" ? "Align your body" : snapshot.phase === "paused" ? "Tracking needs attention" : "Follow the target"}</strong><span>{stage === "tracking" ? snapshot.message : "Enable the camera and stand in view."}</span></div></div><div className="tracking-feedback-card calm"><span className="tracking-feedback-icon"><Target size={19}/></span><div><strong>{stableJoints.length ? "Keep supporting joints steady" : "Move with control"}</strong><span>{stableJoints.length ? stableJoints.map(label).join(" · ") : exercise.instruction}</span></div></div></div>
    </div>
    <div className="tracking-panel">
      <div className="tracking-panel-title"><span className="tracking-panel-icon"><Target size={21}/></span><div><strong>{exercise.name}</strong><small>Move toward the target position</small></div></div>
      <div className="tracking-count"><span>REPETITIONS</span><strong>{snapshot.reps}<small> / {exercise.reps}</small></strong></div>
      <div className={`tracking-status ${snapshot.phase === "paused" ? "paused" : ""}`}><i/><div><strong>{stage === "tracking" ? snapshot.phase === "calibrating" ? "Finding your position" : snapshot.phase === "paused" ? "Tracking paused" : snapshot.phase === "complete" ? "Exercise complete" : snapshot.phase === "target" ? "Hold position" : snapshot.phase === "returning" ? "Return to start" : "Tracking movement" : "Camera setup"}</strong><p>{stage === "tracking" ? snapshot.message : "Position yourself so the moving joints are visible."}</p></div></div>
      <div className="tracking-movements">{movements.map(movement => {
        const scale = Math.max(30, movement.upper + 15);
        return <div className="tracking-target" key={movement.name}><div className="tracking-target-heading"><strong>{label(movement.name)}</strong><span className={targetPhase && movement.atTarget && stableGood ? "target-met" : ""}>{targetPhase && movement.atTarget && stableGood ? "In target" : movement.progress == null ? "Finding movement" : `${Math.round(movement.progress)}° toward target`}</span></div><div className="tracking-target-scale"><div className="tracking-target-green" style={{ left: `${movement.lower / scale * 100}%`, width: `${(movement.upper - movement.lower) / scale * 100}%` }}/>{movement.progress != null && <div className="tracking-target-marker" style={{ left: `${Math.max(0, Math.min(100, movement.progress / scale * 100))}%` }}/>}</div><div className="tracking-target-labels"><span>Start 0°</span><strong>Target {Math.round(movement.lower)}°–{Math.round(movement.upper)}°</strong></div></div>;
      })}</div>
      <div className="tracking-progress"><div style={{ width: `${Math.min(100, snapshot.reps / exercise.reps * 100)}%` }}/></div>
      <div className="tracking-points"><h3>Target points</h3>{movements.map(movement => <div key={movement.name} className="tracking-point-row"><i className={targetPhase && movement.atTarget && stableGood ? "stable" : "active"}/><div><strong>{label(movement.name)}</strong><span>{targetPhase && movement.atTarget && stableGood ? "Target reached" : "Move until this point turns green"}</span></div></div>)}{stableJoints.map(name => {
        const steady = snapshot.trackingVisible && snapshot.angles[name] != null && Math.abs(snapshot.angles[name]) <= exercise.rules.stable;
        return <div key={name} className="tracking-point-row"><i className={steady ? "stable" : "active"}/><div><strong>{label(name)}</strong><span>{steady ? "Keeping steady" : "Keep steady while you move"}</span></div></div>;
      })}<div className="tracking-point-row"><i className={trackingGood ? "stable" : "active"}/><div><strong>Body position</strong><span>{trackingGood ? "Centered and in view" : "Stay centered and in view"}</span></div></div></div>
      <p className="tracking-hint">{exercise.instruction}</p>
      {stage === "tracking" ? <div className="tracking-actions"><Button tone="secondary" disabled={snapshot.phase === "complete"} onClick={recalibrate}><RotateCcw size={16}/> Recalibrate</Button><Button disabled={busy || !snapshot.baseline || snapshot.samples.length < 5} onClick={finish}><Square size={15}/> {busy ? "Saving…" : snapshot.phase === "complete" ? "Save session" : "End & save"}</Button></div> : <Button disabled={busy} onClick={begin}><Camera size={17}/> {busy ? "Preparing…" : "Enable camera"}</Button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <small className="tracking-note">Highlighted: {targetText}. Camera counts are estimates; your therapist can review movement form. Video stays on this device.</small>
    </div>
  </div>;
}
