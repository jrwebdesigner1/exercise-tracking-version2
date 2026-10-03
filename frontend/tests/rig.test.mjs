import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { applyRigPose, prepareRigMotion, RIG_BONES } from '../src/lib/rigMotion.js';

const bytes = readFileSync(new URL('../public/models/skeleton/skeleton_rig.glb', import.meta.url));
const length = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
const nodes = gltf.nodes.map(node => {
  const object = new THREE.Object3D();
  object.name = (node.name || '').replaceAll('.', '');
  if (node.translation) object.position.fromArray(node.translation);
  if (node.rotation) object.quaternion.fromArray(node.rotation);
  if (node.scale) object.scale.fromArray(node.scale);
  return object;
});
gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
const scene = new THREE.Scene();
gltf.scenes[gltf.scene || 0].nodes.forEach(index => scene.add(nodes[index]));
prepareRigMotion(scene);
const position = name => scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());

test('the supplied rig has every exercise pivot', () => {
  for (const names of Object.values(RIG_BONES)) {
    for (const name of names) assert.ok(scene.getObjectByName(name), `${name} is missing`);
  }
});

test('shoulder elevation moves the arm forward or outward from a fixed shoulder', () => {
  applyRigPose(scene, { right_shoulder: 0 }, 'sagittal');
  const shoulder = position('HUMERUSR_125');
  const elbow = position('MCH_forearmR_124');
  applyRigPose(scene, { right_shoulder: 90 }, 'sagittal');
  assert.ok(position('MCH_forearmR_124').z > elbow.z + 3);
  assert.ok(position('HUMERUSR_125').distanceTo(shoulder) < 1e-5);
  applyRigPose(scene, { right_shoulder: 90 }, 'frontal');
  assert.ok(position('MCH_forearmR_124').x < elbow.x - 3);
  applyRigPose(scene, { left_shoulder: 0 }, 'frontal');
  const leftElbow = position('MCH_forearmL_82');
  applyRigPose(scene, { left_shoulder: 90 }, 'frontal');
  assert.ok(position('MCH_forearmL_82').x > leftElbow.x + 3);
  applyRigPose(scene, { left_shoulder: 90 }, 'sagittal');
  assert.ok(position('MCH_forearmL_82').z > leftElbow.z + 3);
});

test('wrist flexion moves the hand forward without moving the elbow', () => {
  applyRigPose(scene, { right_wrist: 0 });
  const elbow = position('MCH_forearmR_124');
  const fingertip = position('FING_INDEX_C.R_102'.replaceAll('.', ''));
  applyRigPose(scene, { right_wrist: 50 });
  assert.ok(position('FING_INDEX_C.R_102'.replaceAll('.', '')).z > fingertip.z + 1);
  assert.ok(position('MCH_forearmR_124').distanceTo(elbow) < 1e-5);
  applyRigPose(scene, { left_wrist: 0 });
  const leftFinger = position('FING_INDEX_CL_58');
  applyRigPose(scene, { left_wrist: 50 });
  assert.ok(position('FING_INDEX_CL_58').z > leftFinger.z + 1);
});

test('elbow and hip flexion move forward while knee flexion moves backward', () => {
  applyRigPose(scene, {});
  const hand = position('HANDR_123');
  const knee = position('TIBIAR_193');
  const ankle = position('FOOTR_192');
  applyRigPose(scene, { right_elbow: 70 });
  assert.ok(position('HANDR_123').z > hand.z + 2);
  applyRigPose(scene, { right_hip: 70 });
  assert.ok(position('TIBIAR_193').z > knee.z + 3);
  applyRigPose(scene, { right_knee: 70 });
  assert.ok(position('FOOTR_192').z < ankle.z - 2);
});

test('positive ankle movement raises the toes', () => {
  applyRigPose(scene, {});
  const toe = position('TOE_INDEX_CR_182');
  applyRigPose(scene, { right_ankle: 30 });
  assert.ok(position('TOE_INDEX_CR_182').y > toe.y + .5);
});

test('a raised shoulder carries the elbow and wrist axes with it', () => {
  applyRigPose(scene, { right_shoulder: 90, right_elbow: 0, right_wrist: 0 }, 'frontal');
  const hand = position('FING_INDEX_C.R_102'.replaceAll('.', ''));
  applyRigPose(scene, { right_shoulder: 90, right_elbow: 70, right_wrist: 50 }, 'frontal');
  assert.ok(position('FING_INDEX_C.R_102'.replaceAll('.', '')).distanceTo(hand) > 2);
  assert.ok(scene.getObjectByName('RADIUSR_88').quaternion.angleTo(scene.getObjectByName('RADIUSR_88').userData.restQuaternion) > .5);
});
