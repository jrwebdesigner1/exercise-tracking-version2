# CHANRE CARE

A therapist and patient exercise portal with a Next.js frontend and a FastAPI/MongoDB backend.

## Run locally

1. Start MongoDB locally or provide a MongoDB Atlas URI.
2. Configure `backend/.env` with your MongoDB URI and database. The local file is ignored by Git. `APP_ENV=development` and `DEV_OPEN_ACCESS=true` allow the direct portal routes to work locally without a login page.
3. Install and start the backend:

   ```powershell
   py -m venv backend\.venv
   py -m pip --python backend\.venv install -r backend\requirements.txt
   cd backend
   py .\main.py
   ```

   Run `py .\main.py` **from the `backend` folder**. `python.exe` may resolve to the Windows Store alias on some systems; `py` or `.\.venv\Scripts\python.exe` uses the installed interpreter. To use another port, run `py .\main.py --port 8001`, then set `BACKEND_URL=http://127.0.0.1:8001` in the frontend terminal before starting Next.js. `--reload` is not needed for this direct command.

4. Install and start the frontend in another terminal, from the project root:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Open `http://localhost:3000/therapist`. On a new local database, enter your therapist name in the one-time setup screen; email is optional. It creates the first workspace in MongoDB. Add patients using their names; email is optional and no password is needed. Open a patient's view from the Patients page. The header switches between the therapist and patient portals without sign-in. No sample therapist, patient, or exercise records are inserted.

Create an exercise in the therapist portal, then choose its recipients in **Review & Publish**. Publishing immediately places it in each selected patient's plan; a separate assignment step is unnecessary. If there is only one patient, that patient is selected automatically. Add a patient before publishing. Drafts retain the selection without appearing in the patient portal.

The builder has four steps: Details, Skeleton, Movement, and Review & Publish. Enter the exercise name, movement settings, and Start, Target, and Return positions. The patient instruction and tracking tolerances use built-in defaults, so the therapist does not need to fill in a separate rules or feedback form.

The setup screen is available only in the local development mode configured above, and only until a therapist account exists. If you prefer the command line, run `py -m backend.create_therapist --name "Your Name"` from the project root.

If you change backend code while using `py .\main.py`, stop it with Ctrl+C and run the command again. `[WinError 10048]` means another process already has port 8000; use the existing backend or stop your own old process before restarting. The pip upgrade notice does not affect startup.

## Data and access

The frontend calls the backend through Next.js's `/api/*` rewrite. Set `BACKEND_URL` for a non-default backend address. MongoDB stores therapists, patients, exercise versions, assignments, sessions, messages, notifications, active JWT sessions, and audit events. The API validates exercise definitions and checks therapist ownership and patient assignments.

The 3D editor and patient preview load the supplied skinned `skeleton_rig.glb` from `frontend/public/models/skeleton/`. The shoulder control rotates the upper arm while the clavicle and scapula remain steady. The spine is visually differentiated, and joint markers show selected and active roles. Shoulder exercises can raise the arm to the side or forward. Wrist, elbow, hip, knee, and ankle movements use the rig's joint directions; downstream axes follow the moving limb. The editor chooses a front or side view based on the movement, and the therapist can still change it. Enter an exact angle or use the slider; preview movement eases from Start to Target, holds, and returns. Larger movements play more slowly. The therapist editor uses Start, Target, and Return position controls without a movement timeline.

The direct therapist and patient routes use no-login demo access when `APP_ENV=development`, `DEV_OPEN_ACCESS=true`, and `COOKIE_SECURE=false`. It also works through a tunnel. Anyone who can reach the demo URL can switch between both portals, so use test records and stop the tunnel after the demo. Existing JWT endpoints remain for older accounts, but the demo flow does not ask for an email or password.

## Cloudflare Tunnel demo

The browser uses relative `/api/*` requests. Next.js forwards them to FastAPI using `BACKEND_URL`, which defaults to `http://127.0.0.1:8000`. If `cloudflared`, Next.js, and FastAPI run on the same computer, **one public frontend hostname is enough**. A separate public backend hostname is optional and is not used by the portal.

1. Start MongoDB and FastAPI, and confirm `http://127.0.0.1:8000/api/health` returns `{"status":"ok"}`.
2. Set `FRONTEND_ORIGIN=https://app.example.com` in `backend/.env`, using the exact HTTPS hostname you will publish, without a trailing slash. To keep local access too, use `FRONTEND_ORIGIN=http://localhost:3000,https://app.example.com`. Restart FastAPI after changing it. If this value is wrong, form submissions return `403 Untrusted origin`.
3. Start the frontend from `frontend` with `npm run build` followed by `npm run start -- -H 127.0.0.1 -p 3000`. Keep `BACKEND_URL=http://127.0.0.1:8000` unless FastAPI runs on a different machine. Set `BACKEND_URL` in the frontend terminal before building and starting if you need a different address.
4. In one named Cloudflare Tunnel, publish `app.example.com` to `http://127.0.0.1:3000`. You may also publish `api.example.com` to `http://127.0.0.1:8000` if you need a direct API address; the frontend still uses its local `/api` proxy.
5. Keep `APP_ENV=development`, `DEV_OPEN_ACCESS=true`, and `COOKIE_SECURE=false` for this no-login demo. Cloudflare Access is not needed for the demo flow. The public URL grants full access to anyone who opens it, including therapist actions. Use only test records; real patient data requires per-user authentication and authorization.
6. Open `https://app.example.com/api/health`, `https://app.example.com/therapist`, and a patient route from a device outside the computer. Then try a write action such as sending a test message. The patient camera needs the tunnel's HTTPS URL and browser camera permission.

Both app processes and `cloudflared` must stay running. A Cloudflare Quick Tunnel can work for a temporary demo, but its URL changes on restart; update `FRONTEND_ORIGIN` and restart FastAPI each time. Do not put the public backend URL in `BACKEND_URL` when both services run on the same computer.

The patient camera runs local MediaPipe Pose detection, plus Hand Landmarker for wrist exercises. The patient is calibrated against their start position, receives simple live feedback, and sees counted repetitions. Joint angles are measured relative to the patient's body orientation, so an opposite-direction bend does not satisfy the target. Only signed joint angle samples are sent to FastAPI, which recounts repetitions against the saved exercise rules and stores a `CAMERA_TRACKED` session summary in MongoDB. Video is not uploaded or stored. These are camera-based estimates, not diagnostic measurements; occlusion, camera angle, and lighting can affect the count. Use the therapist review step for clinical interpretation.

## Checks

```powershell
backend\.venv\Scripts\python.exe -m pytest backend\tests -q
cd frontend
npm run build
npm run lint
node tests\motion.test.mjs
node tests\preview.test.mjs
node tests\rig.test.mjs
```
