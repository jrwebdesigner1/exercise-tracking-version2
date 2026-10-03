export const JOINTS = ["right_shoulder", "right_elbow", "right_wrist", "left_shoulder", "left_elbow", "left_wrist", "right_hip", "right_knee", "right_ankle", "left_hip", "left_knee", "left_ankle"];
export const LIMITS = { shoulder: [-30, 170], elbow: [0, 150], wrist: [-70, 80], hip: [-20, 120], knee: [0, 140], ankle: [-30, 45] };
export const MOVEMENT_LABELS = { shoulder: "Arm elevation", elbow: "Elbow flexion", wrist: "Wrist flexion / extension", hip: "Hip flexion / extension", knee: "Knee flexion", ankle: "Ankle movement" };
export const label = value => value.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
export const viewForCamera = camera => ({ Front: "front", Back: "back", "Right side": "right", "Left side": "left" })[camera] || "front";
export function recommendedCamera(region, side, movementPlane = "frontal") {
  if (region === "Shoulder" && movementPlane === "frontal") return "Front";
  return side === "Left" ? "Left side" : "Right side";
}
export function rolesFor(region, side) {
  const joint = ({ "Wrist / Hand": "wrist", Elbow: "elbow", Shoulder: "shoulder", Hip: "hip", Knee: "knee", Ankle: "ankle" })[region] || "wrist";
  const stable = ({ wrist: "elbow", elbow: "shoulder", shoulder: "elbow", hip: "knee", knee: "hip", ankle: "knee" })[joint];
  const sides = side === "Both" ? ["right", "left"] : [side.toLowerCase()];
  return Object.fromEntries(sides.flatMap(name => [[`${name}_${joint}`, "active"], [`${name}_${stable}`, "stable"]]));
}
export function movementReady(exercise) {
  const active = Object.entries(exercise.roles).filter(([, role]) => role === "active").map(([joint]) => joint);
  const [start, target, end] = exercise.frames;
  return Boolean(start && target && end && active.length && active.every(joint =>
    joint in start.angles && joint in target.angles && joint in end.angles &&
    Math.abs(target.angles[joint] - start.angles[joint]) >= 5 &&
    Math.abs(end.angles[joint] - start.angles[joint]) <= 10
  ));
}
export const newExercise = () => ({ name: "", region: "Wrist / Hand", side: "Right", movementPlane: "frontal", reps: 10, hold: 1, camera: "Right side", instruction: "Follow the movement guide slowly and return to the start position.", roles: rolesFor("Wrist / Hand", "Right"), frames: [], rules: { tolerance: 8, stable: 8, minTime: 2, maxTime: 6, feedback: "Move a little further." }, version: 1, status: "Draft" });
