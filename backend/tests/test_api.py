from datetime import datetime, timezone
from unittest.mock import patch
import os

import mongomock
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.main import create_app


SECRET = "test-secret-that-is-long-enough-for-hs256"


def client_with_therapists(open_access=False):
    db = mongomock.MongoClient().chanre_test
    for name, email in [("Therapist One", "one@example.com"), ("Therapist Two", "two@example.com")]:
        db.users.insert_one({"name": name, "email": email, "password_hash": PasswordHasher().hash("strong-password-123"), "role": "THERAPIST", "active": True, "createdAt": datetime.now(timezone.utc)})
    with patch.dict(os.environ, {"APP_ENV": "development" if open_access else "test", "DEV_OPEN_ACCESS": "true" if open_access else "false"}):
        app = create_app(db=db, secret=SECRET, secure_cookie=False)
    return db, TestClient(app)


def exercise_payload():
    return {"name": "Wrist movement", "region": "Wrist / Hand", "side": "Right", "reps": 8, "hold": 1, "camera": "Right side", "instruction": "Move slowly.", "roles": {"right_wrist": "active", "right_elbow": "stable"}, "frames": [{"name": "Start", "angles": {"right_wrist": 0}}, {"name": "Target", "angles": {"right_wrist": 40}}, {"name": "Return", "angles": {"right_wrist": 0}}], "rules": {"tolerance": 8, "stable": 8, "minTime": 2, "maxTime": 6, "feedback": "Move further."}, "version": 1, "status": "Published"}


def test_no_login_demo_works_through_tunnel_and_accepts_configured_origins():
    db = mongomock.MongoClient().chanre_test
    db.users.insert_one({"name": "Demo Therapist", "role": "THERAPIST", "active": True, "createdAt": datetime.now(timezone.utc)})
    with patch.dict(os.environ, {"APP_ENV": "development", "DEV_OPEN_ACCESS": "true", "FRONTEND_ORIGIN": "http://localhost:3000,https://app.example.com"}):
        app = create_app(db=db, secret=SECRET, secure_cookie=False)
    with TestClient(app, client=("203.0.113.10", 51000)) as client:
        assert client.get("/api/auth/me", headers={"x-chanre-portal": "therapist"}).status_code == 200
        patient = client.post("/api/patients", headers={"origin": "https://app.example.com"}, json={"name": "Demo Patient"})
        assert patient.status_code == 201
        assert client.get("/api/auth/me", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": patient.json()["id"]}).status_code == 200
        assert client.post("/api/patients", headers={"origin": "https://other.example.com"}, json={"name": "Rejected Patient"}).status_code == 403


def tracked_samples():
    return [{"timeMs": time, "angles": {"right_wrist": angle, "right_elbow": 2}, "visible": True}
            for time, angle in [(0, 0), (200, 0), (400, 10), (700, 35), (900, 40), (1800, 39), (1900, 35), (2300, 20), (2600, 0)]]


def test_auth_ownership_and_patient_flow():
    db, client = client_with_therapists()
    with client:
        assert client.get("/api/state").status_code == 401
        assert client.post("/api/auth/login", json={"email": "one@example.com", "password": "bad"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": "one@example.com", "password": "strong-password-123"}).status_code == 200
        patient = client.post("/api/patients", json={"name": "Patient One", "email": "patient@example.com", "password": "patient-password-123", "focus": "Wrist"})
        assert patient.status_code == 201
        patient_id = patient.json()["id"]
        exercise = client.post("/api/exercises", json=exercise_payload())
        assert exercise.status_code == 201
        exercise_id = exercise.json()["id"]
        assert db.assignments.count_documents({"exerciseId": db.exercises.find_one({"name": "Wrist movement"})["_id"]}) == 1
        assert client.post("/api/assignments", json={"exerciseId": exercise_id, "patientId": patient_id}).status_code == 409
        assert client.put(f"/api/exercises/{exercise_id}", json=exercise_payload()).status_code == 409
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/state").status_code == 401
        assert client.post("/api/auth/login", json={"email": "two@example.com", "password": "strong-password-123"}).status_code == 200
        assert client.post("/api/assignments", json={"exerciseId": exercise_id, "patientId": patient_id}).status_code == 404
        assert client.get("/api/state").json()["patients"] == []
        client.post("/api/auth/logout")
        assert client.post("/api/auth/login", json={"email": "patient@example.com", "password": "patient-password-123"}).status_code == 200
        state = client.get("/api/state").json()
        assert len(state["exercises"]) == 1 and len(state["patients"]) == 1
        assert client.post("/api/sessions", json={"exerciseId": exercise_id}).status_code == 422
        session = client.post("/api/sessions", json={"exerciseId": exercise_id, "samples": tracked_samples()})
        assert session.status_code == 201 and session.json()["source"] == "CAMERA_TRACKED"
        assert session.json()["reps"] == 1
        assert client.post("/api/messages", json={"text": "How am I doing?"}).status_code == 201
        assert client.post("/api/exercises", json=exercise_payload()).status_code == 403
        assert db.audit_logs.count_documents({}) >= 4


def test_publish_assigns_only_selected_patients_and_patient_can_practice():
    db, client = client_with_therapists(open_access=True)
    with client:
        first = client.post("/api/patients", json={"name": "First Patient"}).json()["id"]
        second = client.post("/api/patients", json={"name": "Second Patient"}).json()["id"]
        payload = {**exercise_payload(), "status": "Draft", "patientIds": [second]}
        draft = client.post("/api/exercises", json=payload)
        assert draft.status_code == 201
        exercise_id = draft.json()["id"]
        assert db.assignments.count_documents({}) == 0
        published = client.put(f"/api/exercises/{exercise_id}", json={**payload, "status": "Published"})
        assert published.status_code == 200
        assert db.assignments.count_documents({}) == 1
        second_state = client.get("/api/state", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": second}).json()
        assert [item["id"] for item in second_state["exercises"]] == [exercise_id]
        assert second_state["assignments"][0]["exerciseId"] == exercise_id
        assert client.get("/api/state", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": first}).json()["exercises"] == []
        session = client.post("/api/sessions", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": second}, json={"exerciseId": exercise_id, "samples": tracked_samples()})
        assert session.status_code == 201 and session.json()["reps"] == 1
        assert session.json()["exerciseName"] == "Wrist movement"
        assert client.post("/api/exercises", json={**exercise_payload(), "patientIds": [first, second]}).status_code == 201
        assert db.assignments.count_documents({}) == 3
        assert client.post(f"/api/exercises/{exercise_id}/archive").status_code == 200
        archived_state = client.get("/api/state", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": second}).json()
        assert all(item["id"] != exercise_id for item in archived_state["exercises"])
        assert client.post("/api/sessions", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": second}, json={"exerciseId": exercise_id, "samples": tracked_samples()}).status_code == 404


def test_new_version_replaces_patient_plan_without_erasing_old_session():
    _, client = client_with_therapists(open_access=True)
    with client:
        patient_id = client.post("/api/patients", json={"name": "Version Patient"}).json()["id"]
        first = client.post("/api/exercises", json=exercise_payload()).json()
        headers = {"x-chanre-portal": "patient", "x-chanre-patient-id": patient_id}
        saved = client.post("/api/sessions", headers=headers, json={"exerciseId": first["id"], "samples": tracked_samples()})
        assert saved.status_code == 201
        revision = {**exercise_payload(), "name": "Wrist movement updated", "version": 2, "supersedesId": first["id"], "patientIds": [patient_id]}
        second = client.post("/api/exercises", json=revision)
        assert second.status_code == 201
        state = client.get("/api/state", headers=headers).json()
        assert [exercise["id"] for exercise in state["exercises"]] == [second.json()["id"]]
        assert len(state["assignments"]) == 1
        assert state["sessions"][0]["exerciseName"] == "Wrist movement"
        assert client.post("/api/sessions", headers=headers, json={"exerciseId": first["id"], "samples": tracked_samples()}).status_code == 404


def test_publish_requires_owned_patient_and_never_leaks_to_other_therapist():
    db, client = client_with_therapists()
    with client:
        client.post("/api/auth/login", json={"email": "one@example.com", "password": "strong-password-123"})
        own = client.post("/api/patients", json={"name": "Owned Patient"}).json()["id"]
        client.post("/api/auth/logout")
        client.post("/api/auth/login", json={"email": "two@example.com", "password": "strong-password-123"})
        response = client.post("/api/exercises", json={**exercise_payload(), "patientIds": [own]})
        assert response.status_code == 404
        assert db.exercises.count_documents({}) == 0
        assert client.post("/api/exercises", json=exercise_payload()).status_code == 422


def test_invalid_movement_cannot_be_published():
    _, client = client_with_therapists()
    with client:
        client.post("/api/auth/login", json={"email": "one@example.com", "password": "strong-password-123"})
        payload = exercise_payload()
        payload["frames"][1]["angles"]["right_wrist"] = 0
        assert client.post("/api/exercises", json=payload).status_code == 422


def test_incomplete_camera_movement_does_not_count():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    samples = [MotionSample(**{**item, "angles": {"right_wrist": min(item["angles"]["right_wrist"], 24), "right_elbow": 2}})
               for item in tracked_samples()]
    assert analyze_session(exercise_payload(), samples)["reps"] == 0


def test_rep_requires_start_and_stays_within_target_range():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    no_start = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 2}})
                for time, wrist in [(0, 20), (300, 35), (600, 40), (1700, 40), (2200, 20), (3000, 0)]]
    assert analyze_session(exercise_payload(), no_start)["reps"] == 0

    overshoot = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 2}})
                 for time, wrist in [(0, 0), (300, 12), (600, 60), (1700, 60), (2200, 20), (3000, 0)]]
    assert analyze_session(exercise_payload(), overshoot)["reps"] == 0


def test_saved_session_respects_direction_and_uninterrupted_hold():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    extension = exercise_payload()
    extension["frames"][1]["angles"]["right_wrist"] = -40
    positive = [MotionSample(**sample) for sample in tracked_samples()]
    assert analyze_session(extension, positive)["reps"] == 0
    negative = [MotionSample(**{**sample, "angles": {"right_wrist": -sample["angles"]["right_wrist"], "right_elbow": 2}}) for sample in tracked_samples()]
    assert analyze_session(extension, negative)["reps"] == 1
    broken_hold = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 2}, "visible": True})
                   for time, wrist in [(0, 0), (300, -12), (700, -38), (1000, -20), (1400, -39), (1700, -39), (1900, 0)]]
    assert analyze_session(extension, broken_hold)["reps"] == 0


def test_long_hold_can_finish_with_default_timing_rule():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = {**exercise_payload(), "hold": 7, "reps": 1}
    samples = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 2}, "visible": True})
               for time, wrist in [(0, 0), (300, 12), (600, 39), (4000, 39), (7700, 39), (8000, 0)]]
    assert analyze_session(exercise, samples)["reps"] == 1


def test_saved_rep_requires_every_active_joint_from_exercise_definition():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = exercise_payload()
    exercise["roles"] = {"right_shoulder": "active", "left_shoulder": "active", "right_elbow": "stable"}
    exercise["frames"] = [
        {"angles": {"right_shoulder": 0, "left_shoulder": 0}},
        {"angles": {"right_shoulder": 70, "left_shoulder": -50}},
        {"angles": {"right_shoulder": 0, "left_shoulder": 0}},
    ]

    def samples(left_target):
        return [MotionSample(**{"timeMs": time, "angles": {"right_shoulder": right, "left_shoulder": left, "right_elbow": 0}})
                for time, right, left in [(0, 0, 0), (300, 15, -12), (700, 68, left_target),
                                          (1800, 68, left_target), (2200, 20, -15), (3000, 0, 0)]]

    assert analyze_session(exercise, samples(-25))["reps"] == 0
    assert analyze_session(exercise, samples(-49))["reps"] == 1


def test_slow_rep_can_finish_after_outbound_and_return_time():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    samples = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 0}})
               for time, wrist in [(0, 0), (1300, 12), (5000, 39), (6100, 39), (7400, 20), (8100, 0)]]
    assert analyze_session(exercise_payload(), samples)["reps"] == 1


def test_return_just_after_hold_boundary_counts_saved_rep():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    samples = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 0}})
               for time, wrist in [(0, 0), (1300, 12), (1600, 39), (2500, 39), (2600, 20), (3600, 0)]]
    assert analyze_session(exercise_payload(), samples)["reps"] == 1


def test_saved_rep_uses_therapist_return_frame():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = exercise_payload()
    exercise["frames"][2]["angles"]["right_wrist"] = 10

    def samples(ending):
        return [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 0}})
                for time, wrist in [(0, 0), (1300, 12), (1600, 39), (2700, 39), (3000, 20), (3400, ending)]]

    assert analyze_session(exercise, samples(10))["reps"] == 1
    assert analyze_session(exercise, samples(0))["reps"] == 0


def test_saved_rep_uses_deltas_from_nonzero_reference_start():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = exercise_payload()
    exercise["frames"][0]["angles"]["right_wrist"] = 20
    exercise["frames"][1]["angles"]["right_wrist"] = 70
    exercise["frames"][2]["angles"]["right_wrist"] = 25
    samples = [MotionSample(**{"timeMs": time, "angles": {"right_wrist": wrist, "right_elbow": 0}})
               for time, wrist in [(0, 0), (1300, 12), (1600, 48), (2700, 48), (3000, 20), (3400, 5)]]
    assert analyze_session(exercise, samples)["reps"] == 1


def test_saved_rep_tolerates_one_missing_camera_frame_but_not_sustained_loss():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = exercise_payload()
    def samples(sustained):
        raw = [(0, 0, True), (1300, 12, True), (1600, 39, True), (1900, 39, True),
               (1980, 0, False)]
        if sustained:
            raw.append((2300, 0, False))
        raw.extend([(2400 if sustained else 2060, 39, True), (2700, 39, True),
                    (2900, 20, True), (3400, 0, True)])
        return [MotionSample(timeMs=time, angles={"right_wrist": wrist, "right_elbow": 0}, visible=visible)
                for time, wrist, visible in raw]

    assert analyze_session(exercise, samples(False))["reps"] == 1
    assert analyze_session(exercise, samples(True))["reps"] == 0


def test_saved_rep_tolerates_one_noisy_stable_frame_but_not_compensation():
    from backend.motion import analyze_session
    from backend.schemas import MotionSample

    exercise = exercise_payload()
    exercise["hold"] = .4
    def samples(sustained):
        raw = [(0, 0, 0), (1300, 12, 0), (1600, 39, 0), (1750, 39, 14)]
        if sustained:
            raw.append((2050, 39, 14))
        raw.extend(([(2150, 39, 0), (2600, 39, 0)] if sustained else [(1850, 39, 0), (2300, 39, 0)]))
        raw.extend([(2800, 20, 0), (3300, 0, 0)])
        return [MotionSample(timeMs=time, angles={"right_wrist": wrist, "right_elbow": elbow})
                for time, wrist, elbow in raw]

    assert analyze_session(exercise, samples(False))["reps"] == 1
    assert analyze_session(exercise, samples(True))["reps"] == 0


def test_local_open_access_is_explicit():
    _, client = client_with_therapists(open_access=True)
    with client:
        response = client.get("/api/state", headers={"x-chanre-portal": "therapist"})
        assert response.status_code == 200
        assert response.json()["exercises"] == []


def test_first_therapist_can_be_set_up_once_in_local_development():
    db = mongomock.MongoClient().chanre_setup_test
    with patch.dict(os.environ, {"APP_ENV": "development", "DEV_OPEN_ACCESS": "true"}):
        app = create_app(db=db, secret=SECRET, secure_cookie=False)
    with TestClient(app) as client:
        assert client.get("/api/state").status_code == 503
        payload = {"name": "Real Therapist"}
        assert client.post("/api/setup/therapist", json=payload).status_code == 201
        assert db.users.count_documents({"role": "THERAPIST"}) == 1
        assert "password_hash" not in db.users.find_one({"role": "THERAPIST"})
        assert client.get("/api/state").status_code == 200
        first = client.post("/api/patients", json={"name": "Patient One"})
        second = client.post("/api/patients", json={"name": "Patient Two"})
        assert first.status_code == 201 and second.status_code == 201
        for response in [first, second]:
            patient_id = response.json()["id"]
            patient_state = client.get("/api/state", headers={"x-chanre-portal": "patient", "x-chanre-patient-id": patient_id})
            assert patient_state.status_code == 200
            assert patient_state.json()["patients"][0]["id"] == patient_id
        assert client.get("/api/state", headers={"x-chanre-portal": "therapist"}).status_code == 200
        assert client.post("/api/setup/therapist", json={**payload, "email": "other@example.com"}).status_code == 409


def test_therapist_setup_is_unavailable_without_local_open_access():
    db = mongomock.MongoClient().chanre_setup_disabled_test
    with patch.dict(os.environ, {"APP_ENV": "test", "DEV_OPEN_ACCESS": "false"}):
        app = create_app(db=db, secret=SECRET, secure_cookie=False)
    with TestClient(app) as client:
        assert client.post("/api/setup/therapist", json={"name": "Real Therapist", "email": "therapist@example.com", "password": "a-long-setup-password"}).status_code == 404
        assert db.users.count_documents({}) == 0
