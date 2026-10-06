import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowRight, Check, Pause, Play, Save, SlidersHorizontal } from "lucide-react";
import { JOINTS, LIMITS, MOVEMENT_LABELS, label, movementIssues, movementReady, recommendedCamera, rolesFor, viewForCamera } from "@/lib/exercise";
import { useMovementPreview } from "@/lib/useMovementPreview";
import { Badge, Button, Card, Field, Input, PageTitle, Select } from "./ui";

const Skeleton = dynamic(() => import("./Skeleton"), { ssr: false, loading: () => <div className="skeleton-scene loading">Loading 3D model…</div> });
const STEPS = ["Details", "Skeleton", "Movement", "Review & Publish"];
const VIEWS = ["front", "right", "left", "back"];
const POSITIONS = ["Start", "Target", "Return"];

export default function Wizard({ initial, patients, onSave, onClose }) {
  const [exercise, setExercise] = useState(() => structuredClone(initial));
  const [patientIds, setPatientIds] = useState(() => initial.patientIds?.length ? initial.patientIds : patients.length === 1 ? [patients[0].id] : []);
  const [step, setStep] = useState(0);
  const [joint, setJoint] = useState(Object.keys(initial.roles)[0] || "right_wrist");
  const [capture, setCapture] = useState(0);
  const [angles, setAngles] = useState(initial.frames[0]?.angles || {});
  const anglesRef = useRef(angles);
  const [view, setView] = useState(() => viewForCamera(initial.camera));
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = Object.keys(exercise.roles).filter(name => exercise.roles[name] === "active");
  const positionIssues = movementIssues(exercise);
  const detailsReady = Boolean(exercise.name.trim() && exercise.reps >= 1 && exercise.reps <= 50 && exercise.hold >= 0 && exercise.hold <= 30);
  const canPublish = detailsReady && movementReady(exercise) && patientIds.length > 0;
  const togglePatient = id => setPatientIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const canContinue = step === 0 ? detailsReady : step === 1 ? active.length > 0 : step === 2 ? movementReady(exercise) : true;
  const update = patch => setExercise(current => ({ ...current, ...patch }));
  const loadAngles = next => { anglesRef.current = next; setAngles(next); };
  const updateAngle = (name, value) => loadAngles({ ...anglesRef.current, [name]: value });
  const previewAngles = useMovementPreview(exercise.frames, exercise.hold, playing);
  const savePosition = () => {
    const next = [...exercise.frames];
    next[capture] = { name: POSITIONS[capture], angles: Object.fromEntries(active.map(name => [name, Number(anglesRef.current[name] || 0)])) };
    update({ frames: next });
    setPlaying(false);
    if (capture < 2) {
      const nextCapture = capture + 1;
      setCapture(nextCapture);
      loadAngles({ ...(nextCapture === 2 ? next[0]?.angles : next[capture].angles) });
    }
  };
  const persist = async status => {
    setError(""); setBusy(true);
    try { await onSave({ ...exercise, patientIds, status }); }
    catch (problem) { setError(problem.message); setBusy(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const changeRegion = region => { const roles = rolesFor(region, exercise.side); const camera = recommendedCamera(region, exercise.side, exercise.movementPlane); update({ region, roles, camera, frames: [] }); setJoint(Object.keys(roles)[0]); setView(viewForCamera(camera)); loadAngles({}); setPlaying(false); };
  const changeSide = side => { const roles = rolesFor(exercise.region, side); const camera = recommendedCamera(exercise.region, side, exercise.movementPlane); update({ side, roles, camera, frames: [] }); setJoint(Object.keys(roles)[0]); setView(viewForCamera(camera)); loadAngles({}); setPlaying(false); };
  const visualAngles = previewAngles || (step === 2 ? angles : exercise.frames[1]?.angles || exercise.frames[0]?.angles || {});
  return <div className="wizard"><button className="back-link" onClick={onClose}><ArrowLeft size={17}/> Exercises</button><PageTitle eyebrow="EXERCISE BUILDER" title={exercise.name || "Create Exercise"} text="Create a movement guide for your patients." action={<div className="wizard-top-actions"><Button tone="secondary" disabled={busy} onClick={() => persist("Draft")}>Save Draft</Button><Button tone="secondary" disabled={!movementReady(exercise)} onClick={() => setStep(3)}><Play size={16}/> Preview</Button></div>}/>{error && <div className="form-error wizard-save-error" role="alert">{error}</div>}
    <div className="wizard-steps">{STEPS.map((name, index) => <button className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} key={name} onClick={() => index < step && setStep(index)}><span>{index < step ? <Check size={14}/> : String(index+1).padStart(2,"0")}</span>{name}</button>)}</div>
    {step === 0 && <Card className="wizard-form"><div className="form-heading"><span className="form-symbol"><SlidersHorizontal size={22}/></span><h2>Exercise details</h2><p>Only the information needed to prepare the movement.</p></div><div className="form-grid"><Field label="Exercise name"><Input value={exercise.name} onChange={event => update({ name: event.target.value })} placeholder="e.g. Right wrist flexion" maxLength={120}/></Field><Field label="Body region"><Select value={exercise.region} onChange={event => changeRegion(event.target.value)}>{["Wrist / Hand","Elbow","Shoulder","Hip","Knee","Ankle"].map(region => <option key={region}>{region}</option>)}</Select></Field><Field label="Side"><Select value={exercise.side} onChange={event => changeSide(event.target.value)}><option>Right</option><option>Left</option><option>Both</option></Select></Field>{exercise.region === "Shoulder" && <Field label="Shoulder movement"><Select value={exercise.movementPlane || "frontal"} onChange={event => { const movementPlane = event.target.value; const camera = recommendedCamera(exercise.region, exercise.side, movementPlane); update({ movementPlane, camera, frames: [] }); setView(viewForCamera(camera)); loadAngles({}); setPlaying(false); }}><option value="frontal">Raise to the side</option><option value="sagittal">Raise forward</option></Select></Field>}<Field label="Repetitions"><Input type="number" min="1" max="50" value={exercise.reps} onChange={event => update({ reps: Number(event.target.value) })}/></Field><Field label="Hold at target (seconds)"><Input type="number" min="0" max="30" value={exercise.hold} onChange={event => update({ hold: Number(event.target.value) })}/></Field><Field label="Camera view"><Select value={exercise.camera} onChange={event => { update({ camera: event.target.value }); setView(viewForCamera(event.target.value)); }}><option>Front</option><option>Right side</option><option>Left side</option><option>Back</option></Select></Field></div></Card>}
    {step === 1 && <div className="studio-grid"><Card className="studio-sidebar"><div className="mini-heading"><h2>Choose joints</h2><p>Pick what moves and what stays steady.</p></div><div className="joint-picker">{JOINTS.map(name => <button key={name} className={joint === name ? "selected" : ""} onClick={() => setJoint(name)}><i className={`joint-dot ${exercise.roles[name] || "none"}`}/>{label(name)}</button>)}</div></Card><ModelCard roles={exercise.roles} selectedJoint={joint} onSelect={setJoint} angles={{}} movementPlane={exercise.movementPlane} view={view} setView={setView}/><Card className="studio-inspector"><div className="eyebrow">SELECTED JOINT</div><h2>{label(joint)}</h2><p>What should this joint do?</p>{[["active","Moves with the exercise"],["stable","Should stay steady"],["observe","Track only"]].map(([role, description]) => <button className={`role-choice ${exercise.roles[joint] === role ? "selected" : ""}`} key={role} onClick={() => update({ roles: { ...exercise.roles, [joint]: role } })}><i className={`joint-dot ${role}`}/><span><strong>{label(role)}</strong><small>{description}</small></span>{exercise.roles[joint] === role && <Check size={16}/>}</button>)}</Card></div>}
    {step === 2 && <div className="studio-grid movement-grid"><Card className="studio-sidebar"><div className="mini-heading"><h2>Set the positions</h2><p>Adjust each joint, then save Start, Target and Return.</p></div><div className="capture-tabs">{POSITIONS.map((name,index) => <button key={name} className={capture === index ? "selected" : ""} onClick={() => { setCapture(index); loadAngles(exercise.frames[index]?.angles || {}); }}>{exercise.frames[index] ? <Check size={13}/> : index+1} {name}</button>)}</div><div className={`position-validation ${positionIssues.length ? "needs-work" : "ready"}`} aria-live="polite"><strong>{positionIssues.length ? "To continue" : "Movement ready"}</strong>{positionIssues.map(issue => <p key={issue}>{issue}</p>)}{!positionIssues.length && <p>Start, Target, and Return make a complete repetition.</p>}</div>{active.map(name => { const [min,max] = LIMITS[name.split("_")[1]]; return <div className="angle-control" key={name}><div><strong>{label(name)}</strong><b>{Number(angles[name] || 0)}°</b></div><small>{name.endsWith("shoulder") ? exercise.movementPlane === "sagittal" ? "Forward elevation" : "Side elevation" : MOVEMENT_LABELS[name.split("_")[1]]}</small><input type="range" min={min} max={max} value={Number(angles[name] || 0)} onInput={event => updateAngle(name, Number(event.currentTarget.value))}/><div className="angle-extents"><span>{min}°</span><span>{max}°</span></div><label className="angle-number">Exact angle <input type="number" min={min} max={max} step="1" value={Number(angles[name] || 0)} onInput={event => updateAngle(name, Math.min(max, Math.max(min, Number(event.currentTarget.value) || 0)))}/>°</label></div>; })}<div className="position-comparison">{active.map(name => <div key={name}><strong>{label(name)}</strong>{POSITIONS.map((position, index) => <span key={position}>{position}: {exercise.frames[index]?.angles[name] == null ? "—" : `${exercise.frames[index].angles[name]}°`}</span>)}</div>)}</div><Button onClick={savePosition}><Save size={16}/> Save {POSITIONS[capture]} position</Button><Button tone="secondary" disabled={!movementReady(exercise)} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16}/> : <Play size={16}/>} {playing ? "Pause preview" : "Play movement"}</Button></Card><ModelCard roles={exercise.roles} selectedJoint={active[0]} angles={visualAngles} movementPlane={exercise.movementPlane} view={view} setView={setView}/></div>}
    {step === 3 && <div className="preview-grid">
      <ModelCard roles={exercise.roles} selectedJoint={active[0]} angles={visualAngles} movementPlane={exercise.movementPlane} view={view} setView={setView} title="Patient preview"/>
      <Card className="summary-card"><div className="eyebrow">REVIEW & PUBLISH</div><h2>{exercise.name}</h2><p>{exercise.instruction}</p>
        <div className="summary-lines"><div><span>Repetitions</span><strong>{exercise.reps}</strong></div><div><span>Hold</span><strong>{exercise.hold}s</strong></div><div><span>Camera</span><strong>{exercise.camera}</strong></div><div><span>Target allowance</span><select aria-label="Target angle allowance" value={exercise.rules.tolerance} onChange={event => update({ rules: { ...exercise.rules, tolerance: Number(event.target.value) } })}><option value={10}>±10° · easier</option><option value={5}>±5° · closer match</option>{![5, 10].includes(Number(exercise.rules.tolerance)) && <option value={exercise.rules.tolerance}>±{exercise.rules.tolerance}° · current</option>}</select></div></div>
        <div className="recipient-section"><h3>Send to patients</h3><p>Publishing adds this exercise to each selected patient’s plan.</p>
          {patients.length ? <div className="recipient-list">{patients.map(person => <label key={person.id} className="recipient-option"><input type="checkbox" checked={patientIds.includes(person.id)} onChange={() => togglePatient(person.id)}/><span>{person.name}</span></label>)}</div> : <p className="recipient-help">Add a patient in the Patients section before publishing.</p>}
          {patients.length > 1 && !patientIds.length && <p className="recipient-help">Select at least one patient.</p>}
        </div>
        <Button tone="secondary" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16}/> : <Play size={16}/>} {playing ? "Pause" : "Play movement"}</Button>
        <Button disabled={busy || !canPublish} onClick={() => persist("Published")}><Check size={16}/> {busy ? "Publishing…" : "Publish to patient"}</Button>
      </Card>
    </div>}
    <div className="wizard-actions"><span>{step + 1} of {STEPS.length} steps</span><div>{step > 0 && <Button tone="secondary" onClick={() => setStep(step-1)}><ArrowLeft size={16}/> Back</Button>}{step < 3 && <Button disabled={!canContinue} onClick={() => { setPlaying(false); setStep(step+1); }}>Continue <ArrowRight size={16}/></Button>}</div></div>
  </div>;
}

function ModelCard({ roles, selectedJoint, onSelect, angles, movementPlane, view, setView, title = "3D movement model" }) {
  return <Card className="model-card"><div className="model-card-header"><div><div className="eyebrow">CLINICAL VIEWER</div><h2>{title}</h2></div><div className="model-card-status"><Badge tone="mint">Interactive</Badge>{selectedJoint && <span className="model-angle-readout">{label(selectedJoint)} <b>{Math.round(Number(angles[selectedJoint] || 0))}°</b></span>}</div></div><Skeleton roles={roles} selectedJoint={selectedJoint} onSelect={onSelect} angles={angles} movementPlane={movementPlane} view={view}/><div className="model-toolbar"><span><i className="legend-dot active"/> Active <i className="legend-dot stable"/> Stable</span><div>{VIEWS.map(name => <button key={name} className={view === name ? "active" : ""} onClick={() => setView(name)}>{label(name)}</button>)}</div></div></Card>;
}
