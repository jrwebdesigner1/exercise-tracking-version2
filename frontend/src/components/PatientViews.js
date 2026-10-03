import { useState } from "react";
import { useMovementPreview } from "@/lib/useMovementPreview";
import { viewForCamera } from "@/lib/exercise";
import dynamic from "next/dynamic";
import { Activity, ArrowLeft, ArrowRight, Camera, Clock3, HeartPulse, LibraryBig, Pause, Play } from "lucide-react";
import { Badge, Button, Card, displayDate, Empty, PageTitle, SectionTitle } from "./ui";
import LiveTracking from "./LiveTracking";

const Skeleton = dynamic(() => import("./Skeleton"), { ssr: false, loading: () => <div className="skeleton-scene loading">Loading movement…</div> });

export function PatientHome({ data, user, mutate }) {
  const [selected, setSelected] = useState(null);
  const assigned = data.assignments.map(item => data.exercises.find(exercise => exercise.id === item.exerciseId && exercise.status === "Published")).filter(Boolean);
  if (selected) return <Practice exercise={selected} mutate={mutate} onBack={() => setSelected(null)}/>;
  return <>
    <PageTitle eyebrow="YOUR MOVEMENT PLAN" title={`Hello, ${user.name.split(" ")[0]}`} text="Your exercises, all in one place."/>
    <Card className="patient-plan-intro"><span><HeartPulse size={21}/></span><div><strong>{assigned.length ? `${assigned.length} exercise${assigned.length === 1 ? "" : "s"} ready for you` : "Your plan is on its way"}</strong><p>Move at a comfortable pace and follow your therapist’s instructions.</p></div></Card>
    <SectionTitle title="Your exercises" text="Choose an exercise to begin"/>
    <div className="patient-simple-grid">{assigned.map(exercise => <Card className="patient-exercise-card" key={exercise.id}>
      <div className="patient-exercise-top"><span className="patient-exercise-icon"><Activity size={22}/></span><Badge tone="blue">Assigned</Badge></div>
      <h2>{exercise.name}</h2><p>{exercise.instruction}</p>
      <div className="patient-exercise-meta"><span>{exercise.reps} repetitions</span><span>{exercise.hold}s hold</span></div>
      <Button onClick={() => setSelected(exercise)}>View exercise <ArrowRight size={17}/></Button>
    </Card>)}</div>
    {!assigned.length && <Card><Empty icon={LibraryBig} title="No exercises assigned" text="Your therapist’s plan will appear here when it is ready."/></Card>}
  </>;
}

function Practice({ exercise, mutate, onBack }) {
  const [stage, setStage] = useState("preview");
  const [playing, setPlaying] = useState(false);
  const previewAngles = useMovementPreview(exercise.frames, exercise.hold, playing && stage === "preview");
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Back to exercises</button>
    <PageTitle eyebrow={stage === "preview" ? "YOUR EXERCISE" : "LIVE SESSION"} title={exercise.name} text={exercise.instruction}/>
    {stage === "preview" ? <div className="patient-preview-grid">
      <Card className="patient-preview-model"><div className="patient-preview-head"><span>Movement guide</span><Badge tone="mint">Reference</Badge></div><Skeleton roles={exercise.roles} angles={previewAngles || exercise.frames[0]?.angles || {}} movementPlane={exercise.movementPlane} view={viewForCamera(exercise.camera)}/></Card>
      <Card className="patient-preview-side"><div className="eyebrow">BEFORE YOU START</div><h2>Follow the movement</h2><div className="patient-preview-facts"><div><span>Repetitions</span><strong>{exercise.reps}</strong></div><div><span>Hold</span><strong>{exercise.hold} {Number(exercise.hold) === 1 ? "second" : "seconds"}</strong></div><div><span>Camera view</span><strong>{exercise.camera}</strong></div></div><Button tone="secondary" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? "Pause guide" : "Play guide"}</Button><Button onClick={() => { setPlaying(false); setStage("tracking"); }}><Camera size={17}/> Start exercise</Button></Card>
    </div> : <LiveTracking exercise={exercise} mutate={mutate} onDone={onBack}/>}
  </>;
}

export function PatientProgress({ data, user }) {
  const sessions = data.sessions.filter(session => session.patientId === user.id);
  const assigned = data.exercises.filter(exercise => exercise.status === "Published" && data.assignments.some(item => item.exerciseId === exercise.id)).length;
  const totalReps = sessions.reduce((sum, session) => sum + (session.reps || 0), 0);
  return <>
    <PageTitle eyebrow="YOUR PROGRESS" title="Progress" text="See the practice you have recorded."/>
    <div className="metrics three"><Card className="metric-card"><span className="metric-icon blue"><Activity size={22}/></span><strong>{totalReps}</strong><span>Repetitions tracked</span></Card><Card className="metric-card"><span className="metric-icon mint"><Clock3 size={22}/></span><strong>{sessions.length}</strong><span>Sessions recorded</span></Card><Card className="metric-card"><span className="metric-icon violet"><LibraryBig size={22}/></span><strong>{assigned}</strong><span>Assigned exercises</span></Card></div>
    <Card className="content-card"><SectionTitle title="Recent sessions" text="Camera-based movement estimates"/>{sessions.length ? sessions.map(session => <div className="activity-row" key={session.id}><span className="metric-icon blue"><Activity size={18}/></span><div><strong>{session.exerciseName || data.exercises.find(exercise => exercise.id === session.exerciseId)?.name || "Exercise"}</strong><small>{displayDate(session.completedAt)} · {session.reps ?? 0} repetitions counted</small></div><Badge tone={session.reviewed ? "mint" : "amber"}>{session.reviewed ? "Reviewed" : "Awaiting review"}</Badge></div>) : <Empty icon={Activity} title="Your progress starts here" text="Record your first exercise session to see it here."/>}</Card>
  </>;
}
