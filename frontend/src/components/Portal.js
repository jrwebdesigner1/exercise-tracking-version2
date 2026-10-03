import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Activity, ArrowLeftRight, Bell, ClipboardList, HeartPulse, LayoutDashboard, LibraryBig, Menu, MessageCircle, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { newExercise } from "@/lib/exercise";
import { Button, Card, Field, Input } from "./ui";
import Wizard from "./Wizard";
import { Dashboard, ExerciseLibrary, Patients, Sessions, Messages } from "./TherapistViews";
import { PatientHome, PatientProgress } from "./PatientViews";

const BLANK = { therapist: null, exercises: [], patients: [], assignments: [], sessions: [], messages: [], notifications: [] };
const THERAPIST_NAV = [["Dashboard",LayoutDashboard],["Exercises",LibraryBig],["Patients",Users],["Sessions",ClipboardList],["Messages",MessageCircle]];
const PATIENT_NAV = [["Today",HeartPulse],["Progress",Activity],["Messages",MessageCircle]];

export default function Portal({ portal }) {
  const router = useRouter();
  const patientId = portal === "patient" && typeof router.query.patientId === "string" ? router.query.patientId : undefined;
  const [data, setData] = useState(BLANK);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(portal === "therapist" ? "Dashboard" : "Today");
  const [patientPageKey, setPatientPageKey] = useState(0);
  const [wizard, setWizard] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setup, setSetup] = useState({ name: "", email: "" });
  const [setupError, setSetupError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [toast, setToast] = useState("");
  const context = { portal, patientId };
  const refresh = useCallback(async () => {
    const [profile, state] = await Promise.all([api("/auth/me", { portal, patientId }), api("/state", { portal, patientId })]);
    setUser(profile.user); setData(state); setError("");
  }, [portal, patientId]);
  useEffect(() => {
    if (portal === "patient" && !router.isReady) return;
    let active = true;
    Promise.all([api("/auth/me", { portal, patientId }), api("/state", { portal, patientId })]).then(([profile, state]) => { if (active) { setUser(profile.user); setData(state); setError(""); setLoading(false); } }).catch(problem => { if (active) { setError(problem.message); setLoading(false); } });
    return () => { active = false; };
  }, [portal, patientId, router.isReady, refresh]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh().catch(() => {}); }, 20000);
    return () => window.clearInterval(timer);
  }, [user, refresh]);
  const message = text => { setToast(text); window.setTimeout(() => setToast(""), 3400); };
  const createFirstTherapist = async event => {
    event.preventDefault();
    setSetupBusy(true); setSetupError("");
    try {
      await api("/setup/therapist", { method: "POST", body: { ...setup, email: setup.email.trim() || null } });
      await refresh();
      setSetup({ name: "", email: "" });
    } catch (problem) { setSetupError(problem.message); }
    finally { setSetupBusy(false); }
  };
  const mutate = async (path, options, success) => { const result = await api(path, { ...context, ...options }); await refresh().catch(() => {}); if (success) message(success); return result; };
  const open = name => { setPage(name); if (portal === "patient") setPatientPageKey(key => key + 1); setWizard(null); setMobileMenu(false); window.scrollTo({ top: 0, behavior: "auto" }); };
  const saveExercise = async value => {
    const existingDraft = value.id && data.exercises.some(item => item.id === value.id && item.status === "Draft");
    const url = existingDraft ? `/exercises/${value.id}` : "/exercises";
    await mutate(url, { method: existingDraft ? "PUT" : "POST", body: value }, value.status === "Published" ? "Exercise published" : "Draft saved");
    setWizard(null); setPage("Exercises");
  };
  const nav = portal === "therapist" ? THERAPIST_NAV : PATIENT_NAV;
  const unread = data.notifications.filter(item => !item.read).length;
  const returnPatientId = typeof router.query.patientId === "string" && data.patients.some(item => item.id === router.query.patientId) ? router.query.patientId : data.patients[0]?.id;
  const connectionError = ["Sign in required", "Session expired"].includes(error) ? "Workspace access is unavailable." : error;
  if (loading) return <div className="load-screen"><span className="brand-emblem"><Activity size={28}/></span><p>Opening CHANRE CARE…</p></div>;
  if (error) return <div className="load-screen"><span className="brand-emblem"><Activity size={28}/></span><Card className="setup-card">{portal === "therapist" && error === "No account is provisioned for this portal yet" ? <><h1>Set up CHANRE CARE</h1><p>Enter your name to create the first therapist workspace in MongoDB.</p><form onSubmit={createFirstTherapist}><Field label="Your name"><Input required minLength={2} maxLength={120} autoComplete="name" value={setup.name} onChange={event => setSetup(current => ({ ...current, name: event.target.value }))}/></Field><Field label="Email (optional)"><Input type="email" autoComplete="email" value={setup.email} onChange={event => setSetup(current => ({ ...current, email: event.target.value }))}/></Field>{setupError && <div className="form-error" role="alert">{setupError}</div>}<Button type="submit" disabled={setupBusy}>{setupBusy ? "Creating workspace…" : "Create workspace"}</Button></form></> : <><h1>Connect your CHANRE CARE workspace</h1><p>{connectionError}</p><p>{portal === "patient" ? "Create a patient from the therapist portal first." : "Check MongoDB and the backend, then try again."}</p>{portal === "patient" && <Link className="button button-secondary" href="/therapist">Open therapist dashboard</Link>}<Button onClick={() => window.location.reload()}>Try again</Button></>}</Card></div>;
  const firstName = user?.name?.split(" ")[0] || "there";
  return <div className={`app-layout ${portal === "patient" ? "patient-portal" : "therapist-portal"}`}><aside className={`app-sidebar ${mobileMenu ? "visible" : ""}`}>
    <div className="sidebar-brand"><span className="brand-emblem"><Activity size={25}/></span><span>CHANRE CARE</span><button className="sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={20}/></button></div>
    <div className="sidebar-eyebrow">{portal === "therapist" ? "THERAPIST PORTAL" : "PATIENT PORTAL"}</div>
    <nav className="app-nav">{nav.map(([name, Icon]) => <button key={name} className={page === name && !wizard ? "current" : ""} aria-current={page === name && !wizard ? "page" : undefined} onClick={() => open(name)}><Icon size={19} strokeWidth={1.8}/>{name}{name === "Messages" && data.messages.length > 0 && <i/>}</button>)}</nav>
    <div className="sidebar-spacer"/>
    <div className="sidebar-support"><HeartPulse size={21}/><strong>Care in every movement.</strong><p>Clear guidance, steady progress, better recovery.</p></div>
    <div className="sidebar-account"><span className="account-avatar">{user?.initials || firstName.slice(0,2).toUpperCase()}</span><span><strong>{user?.name}</strong><small>{portal === "therapist" ? "Therapist" : "Patient"}</small></span></div>
  </aside><div className="app-main"><header className="app-header"><button className="header-menu" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={21}/></button><div className="header-path">{portal === "therapist" ? "Therapist" : "Patient"}<span>/</span><strong>{wizard ? "Exercise builder" : page}</strong></div><div className="header-end"><Link className="portal-switch" aria-label={portal === "therapist" ? "Open patient portal" : "Open therapist dashboard"} href={portal === "therapist" ? returnPatientId ? `/patient?patientId=${returnPatientId}` : "/patient" : `/therapist?patientId=${user.id}`}><ArrowLeftRight size={16}/><span>{portal === "therapist" ? "Patient portal" : "Therapist dashboard"}</span></Link><div className="notification-wrap"><button className="header-icon" onClick={() => setNotificationOpen(!notificationOpen)} aria-label="Notifications"><Bell size={20}/>{unread > 0 && <i/>}</button>{notificationOpen && <div className="notification-menu"><h3>Notifications</h3>{data.notifications.length ? data.notifications.slice(0,5).map(item => <p key={item.id}>{item.text}</p>) : <p>You’re all caught up.</p>}</div>}</div><span className="account-avatar header-avatar">{user?.initials || firstName.slice(0,2).toUpperCase()}</span></div></header>
    <main className="app-content">{wizard ? <Wizard key={wizard.id || wizard.supersedesId || "new"} initial={wizard} patients={data.patients} onSave={saveExercise} onClose={() => setWizard(null)}/> : portal === "therapist" ? <>
      {page === "Dashboard" && <Dashboard data={data} user={user} open={open} onCreate={() => setWizard(newExercise())}/>}
      {page === "Exercises" && <ExerciseLibrary data={data} mutate={mutate} onCreate={() => setWizard(newExercise())} onEdit={setWizard}/>}
      {page === "Patients" && <Patients data={data} mutate={mutate} onMessage={id => { setSelectedPatient(id); open("Messages"); }}/ >}
      {page === "Sessions" && <Sessions data={data} mutate={mutate}/>}
      {page === "Messages" && <Messages data={data} user={user} portal={portal} selectedPatient={selectedPatient} setSelectedPatient={setSelectedPatient} mutate={mutate}/>}
    </> : <>
      {page === "Today" && <PatientHome key={patientPageKey} data={data} user={user} mutate={mutate}/>}
      {page === "Progress" && <PatientProgress data={data} user={user}/>}
      {page === "Messages" && <Messages data={data} user={user} portal={portal} selectedPatient={user.id} setSelectedPatient={() => {}} mutate={mutate}/>}
    </>}</main></div>{portal === "patient" && <nav className="patient-bottom-nav" aria-label="Patient navigation">{PATIENT_NAV.map(([name, Icon]) => <button key={name} type="button" className={page === name ? "current" : ""} aria-current={page === name ? "page" : undefined} onClick={() => open(name)}><Icon size={21} strokeWidth={1.9}/><span>{name}</span></button>)}</nav>}{toast && <div className="toast"><Activity size={17}/>{toast}</div>}</div>;
}
