import { ArrowRight, CircleHelp } from "lucide-react";

export function Button({ children, tone = "primary", ...props }) { return <button className={`button button-${tone}`} {...props}>{children}</button>; }
export function Card({ children, className = "" }) { return <section className={`surface ${className}`}>{children}</section>; }
export function Badge({ children, tone = "blue" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Input(props) { return <input className="control" {...props}/>; }
export function Select(props) { return <select className="control" {...props}/>; }
export function Empty({ icon: Icon, title, text, action }) { return <div className="empty-state"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function PageTitle({ eyebrow, title, text, action }) { return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>; }
export function SectionTitle({ title, text, action }) { return <div className="section-title"><div><h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>; }
export function LinkAction({ children, onClick }) { return <button className="link-action" onClick={onClick}>{children}<ArrowRight size={16}/></button>; }
export function Note({ children }) { return <div className="soft-note"><CircleHelp size={17}/><span>{children}</span></div>; }
export function Modal({ title, text, onClose, children }) { return <div className="modal-shade" onClick={onClose}><div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}><button className="modal-x" onClick={onClose} aria-label="Close">×</button><h2>{title}</h2>{text && <p>{text}</p>}{children}</div></div>; }
export function displayDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; }
