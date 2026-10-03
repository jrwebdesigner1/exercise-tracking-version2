import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { applyRigPose, prepareRigMotion, RIG_BONES } from "@/lib/rigMotion";

const MODEL = "/models/skeleton/skeleton_rig.glb";
const COLORS = { active: "#1978f2", stable: "#16aa9c", observe: "#e8a63a" };

function CameraControl({ view }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 6;
    controls.target.set(0, .92, 0);
    camera.position.set(...({
      front: [0, .92, 3.15], back: [0, .92, -3.15],
      right: [-3.15, .92, 0], left: [3.15, .92, 0],
    }[view] || [0, .92, 3.15]));
    controls.update();
    let frame;
    const animate = () => { controls.update(); frame = requestAnimationFrame(animate); };
    animate();
    return () => { cancelAnimationFrame(frame); controls.dispose(); };
  }, [camera, gl, view]);
  return null;
}

function RiggedSkeleton({ roles, angles, selectedJoint, onSelect, movementPlane }) {
  const gltf = useLoader(GLTFLoader, MODEL);
  const scene = useMemo(() => {
    const copy = cloneRig(gltf.scene);
    copy.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(copy);
    const center = bounds.getCenter(new THREE.Vector3());
    const height = bounds.getSize(new THREE.Vector3()).y;
    const scale = height > 0 ? 1.82 / height : .045;
    copy.scale.setScalar(scale);
    copy.position.set(-center.x * scale, .92 - center.y * scale, -center.z * scale);
    copy.updateMatrixWorld(true);
    const boneMaterial = new THREE.MeshStandardMaterial({ color: "#d7d3c8", roughness: .82, metalness: 0 });
    const spineMaterial = new THREE.MeshStandardMaterial({ color: "#aebfd0", roughness: .78, metalness: 0 });
    copy.traverse(object => {
      if (object.isMesh) {
        let parent = object.parent;
        while (parent && !parent.name.startsWith("BONES_SPINE")) parent = parent.parent;
        object.material = parent ? spineMaterial : boneMaterial;
      }
    });

    prepareRigMotion(copy);
    for (const [jointName, names] of Object.entries(RIG_BONES)) {
      const pivot = copy.getObjectByName(names[0]);
      if (!pivot) continue;
      const worldScale = pivot.getWorldScale(new THREE.Vector3());
      const markerSize = new THREE.Vector3(.025 / Math.abs(worldScale.x || 1), .025 / Math.abs(worldScale.y || 1), .025 / Math.abs(worldScale.z || 1));
      const marker = new THREE.Group();
      marker.name = `${jointName}_marker`;
      marker.userData.jointName = jointName;
      marker.userData.baseScale = markerSize;
      marker.renderOrder = 10;
      marker.scale.copy(markerSize);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), new THREE.MeshBasicMaterial({ color: "#ffffff", depthTest: false }));
      const centerDot = new THREE.Mesh(new THREE.SphereGeometry(.72, 18, 14), new THREE.MeshBasicMaterial({ color: "#8db8ed", depthTest: false }));
      halo.renderOrder = 10;
      centerDot.renderOrder = 11;
      halo.userData.jointName = jointName;
      centerDot.userData.jointName = jointName;
      marker.userData.centerDot = centerDot;
      marker.add(halo, centerDot);
      pivot.add(marker);
      const hitArea = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitArea.userData.jointName = jointName;
      hitArea.scale.setScalar(2.4);
      marker.add(hitArea);
    }
    return copy;
  }, [gltf.scene]);

  useEffect(() => {
    applyRigPose(scene, angles, movementPlane);
    for (const [jointName] of Object.entries(RIG_BONES)) {
      const marker = scene.getObjectByName(`${jointName}_marker`);
      if (marker) {
        marker.userData.centerDot.material.color.set(selectedJoint === jointName ? "#0869ef" : COLORS[roles[jointName]] || "#8db8ed");
        marker.scale.copy(marker.userData.baseScale).multiplyScalar(selectedJoint === jointName ? 1.3 : roles[jointName] ? 1 : .75);
        marker.visible = Boolean(roles[jointName] || onSelect);
      }
    }
  }, [scene, roles, angles, selectedJoint, onSelect, movementPlane]);

  const select = event => {
    if (!onSelect) return;
    if (event.object.userData.jointName) {
      event.stopPropagation();
      onSelect(event.object.userData.jointName);
      return;
    }
    let closest = null;
    let distance = .11;
    for (const jointName of Object.keys(RIG_BONES)) {
      const marker = scene.getObjectByName(`${jointName}_marker`);
      if (!marker) continue;
      const world = marker.getWorldPosition(new THREE.Vector3());
      const next = world.distanceTo(event.point);
      if (next < distance) { closest = jointName; distance = next; }
    }
    if (closest) { event.stopPropagation(); onSelect(closest); }
  };

  return <primitive object={scene} onClick={select}/>;
}

export default function Skeleton({ roles = {}, angles = {}, selectedJoint, onSelect, view = "front", movementPlane = "frontal" }) {
  return <div className="skeleton-scene">
    <Canvas camera={{ position: [0,.92,3.15], fov: 39 }} dpr={[1,1.7]} shadows>
      <color attach="background" args={["#f3f8ff"]}/>
      <ambientLight intensity={.8}/>
      <hemisphereLight args={["#ffffff", "#bcd1e5", .65]}/>
      <directionalLight position={[3,5,4]} intensity={1.2} castShadow/>
      <directionalLight position={[-2,3,-4]} intensity={.55}/>
      <gridHelper args={[3,12,"#d9e7f4","#ecf3fa"]} position={[0,-.01,0]}/>
      <RiggedSkeleton roles={roles} angles={angles} selectedJoint={selectedJoint} onSelect={onSelect} movementPlane={movementPlane}/>
      <CameraControl view={view}/>
    </Canvas>
    <div className="model-caption">Drag to rotate · Scroll to zoom</div>
  </div>;
}
