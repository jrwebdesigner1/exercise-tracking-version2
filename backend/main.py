"""MongoDB-backed API for the CHANRE CARE portals."""

import os
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError

if __package__:
    from .schemas import AssignmentInput, ExerciseInput, LoginInput, MessageInput, PatientInput, SessionInput, TherapistSetupInput
    from .motion import analyze_session
else:
    # Also support `py main.py` from inside the backend directory.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from backend.schemas import AssignmentInput, ExerciseInput, LoginInput, MessageInput, PatientInput, SessionInput, TherapistSetupInput
    from backend.motion import analyze_session

load_dotenv(Path(__file__).with_name(".env"))
COOKIE = "chanre_session"
HASHER = PasswordHasher()


def utcnow():
    return datetime.now(timezone.utc)


def oid(value: str):
    if not ObjectId.is_valid(value):
        raise HTTPException(400, "Invalid identifier")
    return ObjectId(value)


def public(doc):
    if not doc:
        return None
    result = {key: value for key, value in doc.items() if key not in {"password_hash", "jti"}}
    result["id"] = str(result.pop("_id"))
    for key, value in list(result.items()):
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
    return result


def person(doc):
    result = public(doc)
    result["initials"] = "".join(part[:1].upper() for part in doc["name"].split()[:2])
    return result


def create_app(db=None, secret=None, secure_cookie=None):
    jwt_secret = secret or os.getenv("JWT_SECRET", "")
    mongo_db = db if db is not None else MongoClient(
        os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/chanre_care"),
        serverSelectionTimeoutMS=3000,
    ).get_default_database(default="chanre_care")
    secure = secure_cookie if secure_cookie is not None else os.getenv("COOKIE_SECURE", "false").lower() == "true"
    frontend_origins = {origin.strip().rstrip("/") for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").split(",") if origin.strip()}
    open_development = os.getenv("APP_ENV") == "development" and os.getenv("DEV_OPEN_ACCESS", "false").lower() == "true" and not secure

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        email_index = mongo_db.users.index_information().get("email_1")
        if email_index and not email_index.get("sparse"):
            mongo_db.users.drop_index("email_1")
        mongo_db.users.create_index("email", unique=True, sparse=True)
        mongo_db.assignments.create_index([("exerciseId", ASCENDING), ("patientId", ASCENDING)], unique=True)
        mongo_db.sessions_auth.create_index("expiresAt", expireAfterSeconds=0)
        mongo_db.sessions_auth.create_index("jti", unique=True)
        mongo_db.login_attempts.create_index("email", unique=True)
        yield

    app = FastAPI(title="CHANRE CARE API", lifespan=lifespan)
    app.state.db = mongo_db

    @app.middleware("http")
    async def guard_origin(request: Request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") not in frontend_origins:
                return JSONResponse({"detail": "Untrusted origin"}, status_code=403)
        return await call_next(request)

    def configured():
        if len(jwt_secret) < 32:
            raise HTTPException(503, "JWT_SECRET must contain at least 32 characters")

    def current_user(request: Request):
        if open_development:
            portal = request.headers.get("x-chanre-portal", "therapist")
            if portal == "patient":
                selected = request.headers.get("x-chanre-patient-id")
                query = {"role": "PATIENT", "active": True}
                if selected:
                    query["_id"] = oid(selected)
                user = mongo_db.users.find_one(query)
            else:
                user = mongo_db.users.find_one({"role": "THERAPIST", "active": True})
            if not user:
                raise HTTPException(503, "No account is provisioned for this portal yet")
            return user
        configured()
        token = request.cookies.get(COOKIE)
        if not token:
            raise HTTPException(401, "Sign in required")
        try:
            claims = jwt.decode(token, jwt_secret, algorithms=["HS256"], options={"require": ["sub", "exp", "jti"]})
        except jwt.PyJWTError:
            raise HTTPException(401, "Session expired") from None
        session = mongo_db.sessions_auth.find_one({"jti": claims["jti"], "userId": oid(claims["sub"]), "revoked": False})
        if not session or session["expiresAt"].replace(tzinfo=timezone.utc) <= utcnow():
            raise HTTPException(401, "Session expired")
        user = mongo_db.users.find_one({"_id": oid(claims["sub"]), "active": True})
        if not user or user["role"] != claims.get("role"):
            raise HTTPException(401, "Session expired")
        return user

    def therapist(user=Depends(current_user)):
        if user["role"] != "THERAPIST":
            raise HTTPException(403, "Therapist access required")
        return user

    def patient(user=Depends(current_user)):
        if user["role"] != "PATIENT":
            raise HTTPException(403, "Patient access required")
        return user

    def own_patient(therapist_user, patient_id):
        record = mongo_db.users.find_one({"_id": oid(patient_id), "role": "PATIENT", "therapistId": therapist_user["_id"], "active": True})
        if not record:
            raise HTTPException(404, "Patient not found")
        return record

    def own_exercise(therapist_user, exercise_id):
        record = mongo_db.exercises.find_one({"_id": oid(exercise_id), "therapistId": therapist_user["_id"]})
        if not record:
            raise HTTPException(404, "Exercise not found")
        return record

    def notify(user_id, event, text):
        mongo_db.notifications.insert_one({"userId": user_id, "event": event, "text": text, "createdAt": utcnow(), "read": False})

    def exercise_recipients(payload, user):
        ids = list(dict.fromkeys(payload.patientIds))
        if payload.status != "Published":
            return [own_patient(user, patient_id) for patient_id in ids]
        if not ids:
            patients = list(mongo_db.users.find({"therapistId": user["_id"], "role": "PATIENT", "active": True}, {"_id": 1}).limit(2))
            if len(patients) == 1:
                ids = [str(patients[0]["_id"])]
        if not ids:
            raise HTTPException(422, "Select a patient before publishing")
        return [own_patient(user, patient_id) for patient_id in ids]

    def assign_recipients(exercise, recipients, user):
        for patient_record in recipients:
            doc = {"exerciseId": exercise["_id"], "patientId": patient_record["_id"], "therapistId": user["_id"], "active": True, "createdAt": utcnow()}
            try:
                result = mongo_db.assignments.insert_one(doc)
            except DuplicateKeyError:
                continue
            if exercise.get("supersedesId"):
                mongo_db.assignments.update_one({"exerciseId": exercise["supersedesId"], "patientId": patient_record["_id"]}, {"$set": {"active": False, "replacedBy": exercise["_id"]}})
            notify(patient_record["_id"], "EXERCISE_ASSIGNED", f"New exercise: {exercise['name']}")
            mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "EXERCISE_ASSIGNED", "targetId": result.inserted_id, "createdAt": utcnow()})

    @app.get("/api/health")
    def health():
        try:
            mongo_db.command("ping")
            return {"status": "ok"}
        except PyMongoError:
            raise HTTPException(503, "Database unavailable") from None

    @app.post("/api/setup/therapist", status_code=201)
    def setup_therapist(payload: TherapistSetupInput, request: Request):
        if not open_development:
            raise HTTPException(404, "Not found")
        if mongo_db.users.find_one({"role": "THERAPIST"}):
            raise HTTPException(409, "A therapist account already exists")
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(422, "Enter your name")
        try:
            doc = {"name": name, "role": "THERAPIST", "active": True, "createdAt": utcnow()}
            if payload.email:
                doc["email"] = str(payload.email).lower()
            if payload.password:
                doc["password_hash"] = HASHER.hash(payload.password)
            result = mongo_db.users.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(409, "This email is already in use") from None
        return {"user": person(mongo_db.users.find_one({"_id": result.inserted_id}))}

    @app.post("/api/auth/login")
    def login(payload: LoginInput, response: Response):
        configured()
        email = payload.email.lower()
        attempts = mongo_db.login_attempts.find_one({"email": email}) or {}
        if attempts.get("lockedUntil") and attempts["lockedUntil"].replace(tzinfo=timezone.utc) > utcnow():
            raise HTTPException(429, "Please try again later")
        user = mongo_db.users.find_one({"email": email, "active": True})
        try:
            valid = bool(user and user.get("password_hash") and HASHER.verify(user["password_hash"], payload.password))
        except (VerifyMismatchError, VerificationError):
            valid = False
        if not valid:
            count = attempts.get("count", 0) + 1
            mongo_db.login_attempts.update_one({"email": email}, {"$set": {"count": count, "lockedUntil": utcnow() + timedelta(minutes=15) if count >= 5 else None}}, upsert=True)
            raise HTTPException(401, "Invalid email or password")
        mongo_db.login_attempts.delete_one({"email": email})
        now = utcnow()
        expires = now + timedelta(hours=8)
        jti = secrets.token_urlsafe(32)
        mongo_db.sessions_auth.insert_one({"jti": jti, "userId": user["_id"], "expiresAt": expires, "revoked": False})
        token = jwt.encode({"sub": str(user["_id"]), "role": user["role"], "iat": now, "exp": expires, "jti": jti}, jwt_secret, algorithm="HS256")
        response.set_cookie(COOKIE, token, httponly=True, secure=secure, samesite="lax", max_age=8 * 3600, path="/")
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "LOGIN", "createdAt": now})
        return {"user": person(user)}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, user=Depends(current_user)):
        token = request.cookies.get(COOKIE)
        if not token:
            return {"ok": True}
        claims = jwt.decode(token, jwt_secret, algorithms=["HS256"])
        mongo_db.sessions_auth.update_one({"jti": claims["jti"], "userId": user["_id"]}, {"$set": {"revoked": True}})
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(user=Depends(current_user)):
        return {"user": person(user)}

    @app.get("/api/state")
    def state(user=Depends(current_user)):
        if user["role"] == "THERAPIST":
            therapist_doc = user
            patient_docs = list(mongo_db.users.find({"therapistId": user["_id"], "role": "PATIENT", "active": True}))
            patient_ids = [p["_id"] for p in patient_docs]
            exercises = list(mongo_db.exercises.find({"therapistId": user["_id"]}).sort("createdAt", -1))
            assignments = list(mongo_db.assignments.find({"therapistId": user["_id"], "active": {"$ne": False}}))
            sessions = list(mongo_db.exercise_sessions.find({"therapistId": user["_id"]}).sort("completedAt", -1))
            messages = list(mongo_db.messages.find({"patientId": {"$in": patient_ids}}).sort("createdAt", 1))
        else:
            therapist_doc = mongo_db.users.find_one({"_id": user["therapistId"], "role": "THERAPIST", "active": True})
            patient_docs = [user]
            assignments = list(mongo_db.assignments.find({"patientId": user["_id"], "active": {"$ne": False}}))
            exercise_ids = [a["exerciseId"] for a in assignments]
            exercises = list(mongo_db.exercises.find({"_id": {"$in": exercise_ids}, "status": "Published"}))
            sessions = list(mongo_db.exercise_sessions.find({"patientId": user["_id"]}).sort("completedAt", -1))
            messages = list(mongo_db.messages.find({"patientId": user["_id"]}).sort("createdAt", 1))
        notifications = list(mongo_db.notifications.find({"userId": user["_id"]}).sort("createdAt", -1).limit(30))
        return {"therapist": person(therapist_doc) if therapist_doc else None, "exercises": [public(e) for e in exercises], "patients": [person(p) for p in patient_docs], "assignments": [public(a) for a in assignments], "sessions": [public(s) for s in sessions], "messages": [public(m) for m in messages], "notifications": [public(n) for n in notifications]}

    @app.post("/api/patients", status_code=201)
    def add_patient(payload: PatientInput, user=Depends(therapist)):
        doc = {"name": payload.name.strip(), "focus": payload.focus.strip(), "role": "PATIENT", "therapistId": user["_id"], "active": True, "createdAt": utcnow()}
        if payload.email:
            doc["email"] = str(payload.email).lower()
        if payload.password:
            doc["password_hash"] = HASHER.hash(payload.password)
        try:
            result = mongo_db.users.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(409, "Email already exists") from None
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "PATIENT_CREATED", "targetId": result.inserted_id, "createdAt": utcnow()})
        return person({**doc, "_id": result.inserted_id})

    @app.post("/api/exercises", status_code=201)
    def add_exercise(payload: ExerciseInput, user=Depends(therapist)):
        if payload.supersedesId:
            previous = own_exercise(user, payload.supersedesId)
            if payload.version != previous["version"] + 1:
                raise HTTPException(400, "Version number must follow the previous version")
        recipients = exercise_recipients(payload, user)
        doc = payload.model_dump(exclude={"supersedesId"})
        if recipients:
            doc["patientIds"] = [str(person["_id"]) for person in recipients]
        doc.update({"therapistId": user["_id"], "createdAt": utcnow(), "updatedAt": utcnow()})
        if payload.supersedesId:
            doc["supersedesId"] = oid(payload.supersedesId)
        result = mongo_db.exercises.insert_one(doc)
        if doc["status"] == "Published":
            assign_recipients({**doc, "_id": result.inserted_id}, recipients, user)
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "EXERCISE_CREATED" if doc["status"] == "Draft" else "EXERCISE_PUBLISHED", "targetId": result.inserted_id, "createdAt": utcnow()})
        return public({**doc, "_id": result.inserted_id})

    @app.put("/api/exercises/{exercise_id}")
    def edit_exercise(exercise_id: str, payload: ExerciseInput, user=Depends(therapist)):
        previous = own_exercise(user, exercise_id)
        if previous["status"] != "Draft":
            raise HTTPException(409, "Published versions are immutable; create a new version")
        if payload.version != previous["version"]:
            raise HTTPException(400, "Version cannot be changed in place")
        recipients = exercise_recipients(payload, user)
        update = payload.model_dump(exclude={"supersedesId"})
        if recipients:
            update["patientIds"] = [str(person["_id"]) for person in recipients]
        update["updatedAt"] = utcnow()
        mongo_db.exercises.update_one({"_id": previous["_id"]}, {"$set": update})
        if update["status"] == "Published":
            assign_recipients({**previous, **update}, recipients, user)
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "EXERCISE_PUBLISHED" if update["status"] == "Published" else "EXERCISE_UPDATED", "targetId": previous["_id"], "createdAt": utcnow()})
        return public({**previous, **update})

    @app.post("/api/exercises/{exercise_id}/archive")
    def archive_exercise(exercise_id: str, user=Depends(therapist)):
        record = own_exercise(user, exercise_id)
        mongo_db.exercises.update_one({"_id": record["_id"]}, {"$set": {"status": "Archived", "updatedAt": utcnow()}})
        mongo_db.assignments.update_many({"exerciseId": record["_id"]}, {"$set": {"active": False}})
        return {"ok": True}

    @app.post("/api/assignments", status_code=201)
    def add_assignment(payload: AssignmentInput, user=Depends(therapist)):
        exercise = own_exercise(user, payload.exerciseId)
        patient_record = own_patient(user, payload.patientId)
        if exercise["status"] != "Published":
            raise HTTPException(400, "Only published exercises can be assigned")
        doc = {"exerciseId": exercise["_id"], "patientId": patient_record["_id"], "therapistId": user["_id"], "active": True, "createdAt": utcnow()}
        try:
            result = mongo_db.assignments.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(409, "Already assigned") from None
        notify(patient_record["_id"], "EXERCISE_ASSIGNED", f"New exercise: {exercise['name']}")
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "EXERCISE_ASSIGNED", "targetId": result.inserted_id, "createdAt": utcnow()})
        return public({**doc, "_id": result.inserted_id})

    @app.post("/api/sessions", status_code=201)
    def complete_session(payload: SessionInput, user=Depends(patient)):
        assignment = mongo_db.assignments.find_one({"exerciseId": oid(payload.exerciseId), "patientId": user["_id"], "active": {"$ne": False}})
        if not assignment:
            raise HTTPException(404, "Assignment not found")
        exercise = mongo_db.exercises.find_one({"_id": assignment["exerciseId"], "status": "Published"})
        if not exercise:
            raise HTTPException(409, "This exercise is no longer available")
        summary = analyze_session(exercise, payload.samples)
        doc = {"exerciseId": assignment["exerciseId"], "exerciseName": exercise["name"], "exerciseVersion": exercise["version"], "patientId": user["_id"], "therapistId": user["therapistId"], "completedAt": utcnow(), "reviewed": False, "source": "CAMERA_TRACKED", **summary}
        result = mongo_db.exercise_sessions.insert_one(doc)
        notify(user["therapistId"], "SESSION_COMPLETED", f"{user['name']} recorded {summary['reps']} repetitions")
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "SESSION_COMPLETED", "targetId": result.inserted_id, "createdAt": utcnow()})
        return public({**doc, "_id": result.inserted_id})

    @app.patch("/api/sessions/{session_id}/review")
    def review_session(session_id: str, user=Depends(therapist)):
        record = mongo_db.exercise_sessions.find_one({"_id": oid(session_id), "therapistId": user["_id"]})
        if not record:
            raise HTTPException(404, "Session not found")
        mongo_db.exercise_sessions.update_one({"_id": record["_id"]}, {"$set": {"reviewed": True, "reviewedAt": utcnow()}})
        notify(record["patientId"], "SESSION_REVIEWED", "Your therapist reviewed your practice")
        return {"ok": True}

    @app.post("/api/messages", status_code=201)
    def send_message(payload: MessageInput, user=Depends(current_user)):
        if user["role"] == "THERAPIST":
            if not payload.patientId:
                raise HTTPException(400, "Patient is required")
            patient_record = own_patient(user, payload.patientId)
            recipient_id = patient_record["_id"]
        else:
            patient_record = user
            recipient_id = user["therapistId"]
        doc = {"patientId": patient_record["_id"], "therapistId": patient_record["therapistId"], "from": "therapist" if user["role"] == "THERAPIST" else "patient", "text": payload.text.strip(), "createdAt": utcnow(), "at": utcnow().strftime("%H:%M")}
        if not doc["text"]:
            raise HTTPException(422, "Message cannot be blank")
        result = mongo_db.messages.insert_one(doc)
        notify(recipient_id, "MESSAGE_RECEIVED", "New message")
        mongo_db.audit_logs.insert_one({"actorId": user["_id"], "event": "MESSAGE_SENT", "targetId": result.inserted_id, "createdAt": utcnow()})
        return public({**doc, "_id": result.inserted_id})

    return app


app = create_app()


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Run the CHANRE CARE backend")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)
