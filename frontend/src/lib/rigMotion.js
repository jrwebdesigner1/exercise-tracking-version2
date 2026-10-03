import * as THREE from "three";

export const RIG_BONES = {
  left_shoulder: ["HUMERUSL_83"], right_shoulder: ["HUMERUSR_125"],
  left_elbow: ["MCH_forearmL_82"], right_elbow: ["MCH_forearmR_124", "RADIUSR_88", "ULNAR_89"],
  left_wrist: ["HANDL_81"], right_wrist: ["HANDR_123"],
  left_hip: ["MCH_femurL_234"], right_hip: ["MCH_femurR_195"],
  left_knee: ["TIBIAL_232"], right_knee: ["TIBIAR_193"],
  left_ankle: ["FOOTL_231"], right_ankle: ["FOOTR_192"],
};

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);
const JOINT_ORDER = Object.keys(RIG_BONES);

export function prepareRigMotion(scene) {
  scene.updateMatrixWorld(true);
  for (const names of Object.values(RIG_BONES)) {
    for (const name of names) {
      const bone = scene.getObjectByName(name);
      if (!bone?.parent) continue;
      const parentRest = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.userData.restQuaternion = bone.quaternion.clone();
      bone.userData.axisX = WORLD_X.clone().applyQuaternion(parentRest).normalize();
      bone.userData.axisZ = WORLD_Z.clone().applyQuaternion(parentRest).normalize();
    }
  }
  for (const side of ["left", "right"]) {
    const shoulder = scene.getObjectByName(RIG_BONES[`${side}_shoulder`][0]);
    const elbow = scene.getObjectByName(RIG_BONES[`${side}_elbow`][0]);
    if (!shoulder || !elbow) continue;
    const upperArm = elbow.getWorldPosition(new THREE.Vector3()).sub(shoulder.getWorldPosition(new THREE.Vector3()));
    const outward = side === "right" ? -1 : 1;
    shoulder.userData.restElevation = THREE.MathUtils.radToDeg(Math.atan2(outward * upperArm.x, -upperArm.y));
    shoulder.userData.restFlexion = THREE.MathUtils.radToDeg(Math.atan2(upperArm.z, -upperArm.y));
  }
}

export function applyRigPose(scene, angles = {}, movementPlane = "frontal") {
  for (const names of Object.values(RIG_BONES)) {
    for (const name of names) {
      const bone = scene.getObjectByName(name);
      if (bone?.userData.restQuaternion) bone.quaternion.copy(bone.userData.restQuaternion);
    }
  }
  for (const jointName of JOINT_ORDER) {
    const [side, kind] = jointName.split("_");
    const names = RIG_BONES[jointName];
    const pivot = scene.getObjectByName(names[0]);
    const angle = Number(angles[jointName] || 0);
    const forwardShoulder = kind === "shoulder" && movementPlane === "sagittal";
    const axisName = kind === "shoulder" && !forwardShoulder ? "axisZ" : "axisX";
    let degrees;
    if (forwardShoulder) degrees = -(angle - (pivot?.userData.restFlexion || 0));
    else if (kind === "shoulder") degrees = (side === "right" ? -1 : 1) * (angle - (pivot?.userData.restElevation || 0));
    // Positive flexion faces the model's front (+Z); knee flexion goes posteriorly.
    else degrees = ["elbow", "wrist", "hip", "ankle"].includes(kind) ? -angle : angle;
    const radians = THREE.MathUtils.degToRad(degrees);
    for (const name of names) {
      const bone = scene.getObjectByName(name);
      if (!bone?.userData.restQuaternion) continue;
      const rotation = new THREE.Quaternion().setFromAxisAngle(bone.userData[axisName], radians);
      bone.quaternion.copy(bone.userData.restQuaternion).premultiply(rotation);
    }
  }
  scene.updateMatrixWorld(true);
}
