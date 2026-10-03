Yes. I would now define this as **two extremely simple products sitting on top of one fairly sophisticated motion-analysis platform**:

- **Therapist Portal** — creates exercises, assigns them, reviews patient performance, chats with patients.
- **Patient Portal** — sees assigned exercises, follows the animated skeleton, performs the exercise, gets live corrections, and reviews progress.

The therapist should **never feel like they are using Blender or a developer tool**, and the patient should **never feel like they are using an AI/computer-vision application**.

---

# 1. Final product architecture

```text
                          PLATFORM
                             │
          ┌──────────────────┴──────────────────┐
          │                                     │
          ▼                                     ▼
   THERAPIST PORTAL                       PATIENT PORTAL
          │                                     │
      Simple Login                          Simple Login
          │                                     │
      Dashboard                              Home
          │                                     │
     Exercise Library                   Assigned Exercises
          │                                     │
   Create Exercise Wizard                Exercise Preview
          │                                     │
   3D Skeleton Authoring                 Camera Calibration
          │                                     │
   Publish + Assign                     Live Exercise Tracking
          │                                     │
     Review Sessions                   Real-Time Feedback
          │                                     │
        Messages                            Session Result
          │                                     │
     Notifications                            Progress
          │                                     │
        Profile                              Messages
                                                │
                                           Notifications
```

Underneath both portals:

```text
Next.js
   │
   ├── Three.js / React Three Fiber
   │        ↓
   │   Therapist skeleton editor
   │
   ├── MediaPipe
   │        ↓
   │   Patient body detection
   │
   └── WebSocket
            ↓
         FastAPI
            ↓
     Movement Engine
            ↓
     MongoDB / Redis
```

---

# 2. Technology responsibilities

The stack should have very clear responsibilities.

| Technology | Responsibility |
|---|---|
| **Next.js** | Therapist and patient web applications |
| **Tailwind CSS** | Responsive UI and design system |
| **Inter** | Application font |
| **Lucide React** | Icons |
| **Three.js** | 3D skeleton, bones, animation |
| **React Three Fiber** | React integration for Three.js |
| **MediaPipe Pose** | Patient body landmark detection |
| **MediaPipe Hands** | Detailed wrist/hand/finger tracking where needed |
| **OpenCV** | Optional video/frame processing, diagnostics |
| **FastAPI** | APIs and real-time movement analysis |
| **NumPy** | Geometry, vectors, joint angles |
| **WebSocket** | Live tracking, chat, notifications |
| **MongoDB** | Exercises, templates, assignments, sessions |
| **Redis** | Temporary live-session state, caching |
| **Object Storage** | Optional thumbnails/assets |

The architectural rule should be:

```text
Three.js
= What SHOULD the movement look like?

MediaPipe
= What IS the patient doing?

FastAPI movement engine
= How different are the two?
```

---

# 3. Authentication should remain simple

## Therapist login

Therapists should not publicly register.

Recommended:

```text
Organisation creates therapist
        ↓
Invitation sent
        ↓
Therapist sets password
        ↓
Login
```

Login screen:

```text
Welcome back

Email
[                         ]

Password
[                         ]

       Sign In

Forgot Password?
```

Nothing else.

---

## Patient login

Patient:

```text
Email / Mobile
Password

Sign In
```

You can add OTP later.

For V1, a normal password login is enough.

---

# 4. Roles

Keep roles simple initially:

```text
SYSTEM_ADMIN
THERAPIST
PATIENT
```

For this exercise product, the UI terminology should always say:

> **Therapist**

and:

> **Patient**

Do not expose "admin" terminology inside the therapist application.

---

# 5. Therapist Portal navigation

Keep the sidebar very small.

```text
Logo

Dashboard

Exercises
Patients
Sessions
Messages

────────────

Profile
```

Notifications stay in the header.

```text
Search       💬      🔔      Avatar
```

Avoid 15 menu items.

---

# 6. Therapist dashboard

The dashboard should answer only:

> What requires my attention today?

Example:

```text
Good morning, Dr. Kumar

Overview

┌─────────────┐
│     24      │
│ Patients    │
└─────────────┘

┌─────────────┐
│     38      │
│ Exercises   │
└─────────────┘

┌─────────────┐
│     12      │
│ Sessions    │
│ Today       │
└─────────────┘

┌─────────────┐
│      4      │
│ Review      │
└─────────────┘
```

Below:

```text
Sessions requiring review

Patient       Exercise             Status
Rahul         Wrist Flexion        Review
Meera         Knee Extension       Review
```

And:

```text
Recent Messages
```

No unnecessary charts initially.

---

# 7. Exercise Library

This becomes the therapist's main workspace.

```text
Exercises                               + Create Exercise

[ Search... ] [ Body region ] [ Status ]

Exercise           Region        Version      Status
-----------------------------------------------------
Wrist Flexion      Wrist         v3           Published
Knee Extension     Knee          v1           Published
Shoulder Flexion   Shoulder      v2           Draft
```

Actions:

```text
View
Edit
Duplicate
Create New Version
Archive
Assign
```

Put them inside `•••`.

Don't fill every row with buttons.

---

# 8. Creating an exercise must be a wizard

This is one of the most important UX decisions.

Do not give therapists one huge complex page.

Use:

```text
1. Details
      ↓
2. Skeleton
      ↓
3. Movement
      ↓
4. Rules
      ↓
5. Preview
      ↓
6. Publish
```

The therapist always knows where they are.

---

# 9. Step 1 — Exercise Details

Simple form:

```text
Create Exercise

Exercise Name
[ Right Wrist Flexion ]

Body Region
[ Wrist / Hand ]

Side
[ Right ]

Recommended Repetitions
[ 10 ]

Hold
[ 1 second ]

Camera Position
[ Right Side ]

Short Patient Instruction
[ Keep your forearm steady and bend your wrist slowly. ]

                        Continue →
```

Do not ask for technical parameters here.

---

# 10. Step 2 — Skeleton Setup

Now the therapist sees the skeleton.

Desktop:

```text
┌───────────────┬──────────────────────────┬─────────────────┐
│ Body          │                          │ Selected Joint  │
│               │                          │                 │
│ Shoulder ○    │                          │ Right Wrist     │
│ Elbow    ○    │       3D SKELETON        │                 │
│ Wrist    ●    │                          │ Role            │
│ Hand     ○    │            ○             │ ● Active        │
│               │           /|\            │ ○ Stable        │
│ Hip      ○    │            |             │ ○ Observe       │
│ Knee     ○    │           / \            │                 │
│ Ankle    ○    │                          │ Continue →      │
└───────────────┴──────────────────────────┴─────────────────┘
```

---

# 11. Skeleton structure

The skeleton must have hierarchy.

```text
Pelvis
│
├── Spine
│   └── Chest
│       ├── Neck
│       │    └── Head
│       │
│       ├── Right Shoulder
│       │      └── Upper Arm
│       │            └── Elbow
│       │                 └── Forearm
│       │                      └── Wrist
│       │                           └── Hand
│       │
│       └── Left Shoulder
│              └── ...
│
├── Right Hip
│      └── Thigh
│            └── Knee
│                  └── Lower Leg
│                        └── Ankle
│
└── Left Hip
       └── ...
```

This means:

```text
Rotate shoulder
```

naturally moves:

```text
arm
elbow
forearm
wrist
hand
```

But rotating:

```text
wrist
```

doesn't move the shoulder.

---

# 12. Skeleton visual style

Don't use a realistic muscular avatar for V1.

Use a clean clinical skeleton:

```text
Joint = small sphere
Bone = rounded cylinder
```

Default:

```text
soft neutral blue/grey
```

Selected:

```text
bright blue
```

Active:

```text
blue
```

Stable:

```text
teal
```

Observed:

```text
amber
```

Problem/error:

```text
red
```

---

# 13. Selecting joints

Therapist clicks:

```text
Right Wrist
```

Then selects the joint role.

### Active

Should move.

```text
Right Wrist
```

### Stable

Should remain approximately stable.

```text
Right Elbow
Right Shoulder
```

### Observe

Track for analytics but don't directly invalidate a rep.

---

# 14. Joint movement should use clinical language

The therapist should **not see**:

```text
X = 40°
Y = 12°
Z = -8°
```

unless advanced mode is enabled.

Show:

```text
Right Wrist

Flexion / Extension
[──────────●─────────]

Current
45°
```

For shoulder:

```text
Flexion
Extension
Abduction
Adduction
Internal Rotation
External Rotation
```

For forearm:

```text
Pronation
Supination
```

Internally you still use 3D rotations/quaternions.

The UI should hide that complexity.

---

# 15. Anatomical constraints

Therapist should not accidentally create:

```text
Elbow rotated backward 270°
```

Each joint therefore has movement constraints.

Conceptually:

```javascript
rightWrist: {
  flexionExtension: {
    min: -70,
    max: 80
  }
}
```

These numbers must ultimately be reviewed by your clinical/physiotherapy team.

The software should stop impossible rotations.

---

# 16. Step 3 — Movement Creation

This is where the therapist defines the exercise.

The process should feel extremely simple:

```text
Set Start Position
       ↓
Move skeleton
       ↓
Save Position
       ↓
Move skeleton
       ↓
Save Position
       ↓
Preview
```

Do not present animation terminology aggressively.

Instead of saying:

```text
Add animation quaternion keyframe
```

say:

```text
Save Position
```

The system internally stores a keyframe.

---

# 17. Therapist movement creation example

Suppose:

> Right Wrist Flexion

### Position 1

```text
Start
Wrist = neutral
```

Therapist clicks:

```text
Save Start Position
```

---

### Position 2

Therapist bends wrist.

```text
Wrist = 45°
```

Clicks:

```text
Save Target Position
```

---

### Position 3

Therapist returns wrist.

Clicks:

```text
Save Return Position
```

Now:

```text
Neutral
   ↓
45° Flexion
   ↓
Neutral
```

becomes one complete repetition.

---

# 18. Timeline

The therapist can see:

```text
0 sec        1 sec         2 sec

●────────────◆────────────●

Start        Target       Return
```

Controls:

```text
▶ Play

⏸ Pause

↻ Loop

+ Add Position
```

Don't recreate Blender.

---

# 19. Animation interpolation

Internally:

```text
Position A
      ↓
interpolation
      ↓
Position B
```

The therapist does not create 30 frames.

Three.js interpolates them.

Example:

```text
0° → 45°
```

becomes:

```text
0
5
10
15
20
25
30
35
40
45
```

smoothly.

Use quaternion interpolation internally.

---

# 20. Multiple moving joints

Example:

> Shoulder Flexion

Therapist can define:

```text
Shoulder = Active

Elbow = Stable

Wrist = Stable
```

Start:

```text
Shoulder 10°
Elbow 175°
```

Target:

```text
Shoulder 150°
Elbow 175°
```

The arm animation is generated.

---

# 21. Therapist preview

A large:

```text
Preview Exercise
```

button should exist after movement creation.

The therapist sees:

```text
Right Wrist Flexion

       ○
      /|\
       |
      / \

▶  movement playing

Front
Side
Back
Free View
```

They can rotate the camera around the skeleton without modifying the exercise.

---

# 22. Step 4 — Rules

This should also remain simple.

Example:

```text
Movement Rules

Right Wrist

Target Range
45° – 55°


Allowed Variation
± 8°


Right Elbow

Keep Stable

Maximum Movement
8°


Movement Time

Minimum
2 sec

Maximum
6 sec


Target Hold

1 sec
```

---

# 23. Therapist doesn't create code conditions

They shouldn't see:

```javascript
if (jointAngle < target - tolerance)
```

Instead show:

```text
When wrist does not reach the target:

Feedback

"Bend your wrist slightly further."
```

---

# 24. Common feedback templates

Provide reusable feedback:

```text
Move slightly higher

Move slightly lower

Keep your elbow steady

Keep your back straight

Slow down

Move slightly faster

Hold this position

Return to the starting position

Move closer to the camera

Move slightly backward
```

Therapist can edit the wording if needed.

---

# 25. Step 5 — Preview and Testing

Before publication:

```text
Exercise Preview

Right Wrist Flexion

10 reps

Camera:
Right Side

[ animated skeleton ]

Target:
45°–55°

Elbow:
Keep stable

Expected Rep:
3–5 seconds


▶ Play Exercise

           Back        Publish
```

---

# 26. System validation before publish

Automatically check:

```text
Exercise name exists
Active joint configured
Starting position exists
Target exists
Return exists
Camera position selected
Rep condition exists
Movement is anatomically allowed
Rules configured
```

If something is missing:

```text
1 item needs attention

Target position is missing.
```

Do not show developer-style errors.

---

# 27. Publishing

Published exercise:

```text
Wrist Flexion
Version 1
Published
```

Once published, don't silently overwrite it.

Edit:

```text
v1 Published
    ↓
Create v2 Draft
```

Old patient sessions stay associated with v1.

---

# 28. Exercise Assignment

Therapist opens:

```text
Patients
  ↓
Ravi Kumar
```

Clicks:

```text
Assign Exercise
```

Then:

```text
Right Wrist Flexion

Reps
10

Sessions per day
2

Start
Oct 3

End
Oct 10

Assign
```

Patient receives notification.

---

# 29. Therapist Patients page

Keep this simple.

```text
Patients

Search...

Patient         Current Plan      Last Session
------------------------------------------------
Ravi            Wrist Rehab       Today
Meera           Knee Rehab        Yesterday
```

Click patient.

---

# 30. Therapist Patient Detail

```text
Ravi Kumar

Overview

Assigned Exercises
Recent Sessions
Progress
Messages
```

Example:

```text
Right Wrist Flexion

10 reps/day

Last Session

9 / 10 valid
Average ROM 47°
Average Time 4.1 sec

View Session
```

---

# 31. Therapist session review

Example:

```text
Right Wrist Flexion

Patient
Ravi

Oct 2 • 10:31 AM

Completed
9 / 10

Average ROM
46°

Average Rep Duration
4.2 sec

Corrections
3


Rep     Duration     ROM      Status
----------------------------------------
1       4.1 sec      48°      Good
2       3.9 sec      47°      Good
3       4.4 sec      39°      Low ROM
4       4.2 sec      46°      Elbow moved
```

The therapist doesn't need raw MediaPipe values.

---

# 32. Session issue categories

Show understandable issues:

```text
Incomplete range of motion

Elbow compensation

Body moved out of position

Movement too fast

Movement too slow

Target not held long enough

Tracking interrupted
```

---

# 33. Therapist chat

From patient/session:

```text
Message Patient
```

Chat can attach the session.

Example:

```text
Regarding

Right Wrist Flexion
Oct 2 Session
Rep 4

Your movement is improving.
Please try to keep your elbow stable.
```

Much better than a generic WhatsApp-style chat disconnected from exercise context.

---

# 34. Therapist notifications

Header:

```text
🔔 3
```

Examples:

```text
Ravi completed Wrist Flexion.

Meera sent you a message.

A session needs review.
```

Click takes them directly to the appropriate screen.

---

# 35. Patient Portal navigation

Patient experience should be even simpler.

Desktop:

```text
Home
Exercises
Progress
Messages
```

Mobile bottom navigation:

```text
Home     Exercises     Progress     Chat
```

Profile from avatar.

---

# 36. Patient home

The patient should immediately understand:

> What do I need to do today?

```text
Good morning, Ravi

Today's Exercises

┌─────────────────────────────┐
│ Right Wrist Flexion         │
│                             │
│ 10 reps                     │
│                             │
│          Start Exercise →   │
└─────────────────────────────┘

┌─────────────────────────────┐
│ Knee Extension              │
│                             │
│ 8 reps                      │
│                             │
│          Start Exercise →   │
└─────────────────────────────┘
```

No complicated analytics on the home page.

---

# 37. Patient opens exercise

Screen:

```text
Right Wrist Flexion

10 repetitions

Keep your elbow steady and
bend your wrist gently.

       [ Animated Skeleton ]

          ▶ Preview


Camera Position

Place the camera on your right side.

          Start Exercise
```

Patient should watch the exact animation created by the therapist.

---

# 38. Patient camera permission

Before browser permission:

```text
Camera Access

We use your camera to track your movement
during this exercise.

Video is not stored by default.

       Enable Camera
```

Clear and trustworthy.

---

# 39. Calibration

This should happen automatically.

```text
Camera
  ↓
Detect patient
  ↓
Required joints visible
  ↓
Correct distance
  ↓
Correct camera side
  ↓
Body calibration
  ↓
Ready
```

Screen:

```text
Position yourself

┌─────────────────────────┐
│                         │
│        USER             │
│                         │
└─────────────────────────┘

✓ Shoulder visible
✓ Elbow visible
✓ Wrist visible

⚠ Move slightly backward
```

Once everything passes:

```text
✓ Ready

Start
```

---

# 40. Patient spatial tracking

This should definitely be part of your system.

Track:

```text
Body centre

Distance relative to calibration

Left/right position

Vertical position

Body orientation

Required joints visibility

Out-of-frame state
```

This is separate from exercise movement analysis.

---

# 41. Spatial tracking modes

Every exercise should specify:

```text
FIXED_POSITION
```

or:

```text
MOVEMENT_ALLOWED
```

or:

```text
MOVEMENT_REQUIRED
```

Example wrist exercise:

```text
FIXED_POSITION
```

Patient should remain approximately centered.

Walking exercise:

```text
MOVEMENT_REQUIRED
```

Moving through space is expected.

---

# 42. Relative distance detection

With an ordinary webcam, don't promise:

```text
You are exactly 2.37 metres away.
```

Instead:

```text
Too close
Correct distance
Too far
```

Calculate using body scale:

```text
calibrated shoulder width
vs
current shoulder width
```

If body becomes much larger:

```text
patient moved closer
```

If smaller:

```text
patient moved farther
```

---

# 43. User tracking state machine

Use:

```text
SEARCHING
   ↓
DETECTED
   ↓
CALIBRATING
   ↓
READY
   ↓
TRACKING
```

If visibility drops:

```text
TRACKING
   ↓
LOW_CONFIDENCE
```

If patient disappears:

```text
USER_LOST
```

UI:

```text
Tracking paused

Please return to the camera area.
```

When user returns:

```text
Recalibrate
   ↓
Resume
```

Do not restart the entire session.

---

# 44. MediaPipe processing

Recommended architecture:

```text
Patient Browser
      ↓
Camera
      ↓
MediaPipe
      ↓
Landmarks
```

Send landmarks to backend instead of streaming the full camera feed.

That gives:

```text
less bandwidth
less latency
less backend CPU
better privacy
```

---

# 45. Body pose data

For each frame:

```text
shoulder
elbow
wrist
hip
knee
ankle
etc.
```

For wrist/hand-specific exercises:

```text
MediaPipe Pose
+
MediaPipe Hand Landmarker
```

because fine wrist/hand articulation needs more detailed landmarks.

---

# 46. Normalization

This is absolutely required.

Patient A:

```text
190 cm
```

Patient B:

```text
155 cm
```

must both work.

Normalize against:

```text
pelvis centre

shoulder width

torso length

body orientation
```

Do not compare screen pixels directly.

---

# 47. Reference movement

The therapist-created skeleton template contains:

```text
Start position

Target position

Return position

Expected joint angles

Stable joints

Allowed tolerance

Expected phases
```

---

# 48. Patient movement

MediaPipe gives:

```text
actual shoulder

actual elbow

actual wrist

actual hip
```

Convert them into:

```text
joint angles

relative coordinates

orientation

range of motion

movement velocity
```

---

# 49. Compare phase to phase

Do not do:

```text
Template second 1.2
=
Patient second 1.2
```

because patients move at different speeds.

Instead:

```text
Patient is in TARGET phase

Compare against
TARGET reference
```

This is one of the most important technical decisions.

---

# 50. Exercise state machine

Example:

```text
READY
  ↓
MOVING_OUT
  ↓
TARGET
  ↓
HOLD
  ↓
RETURNING
  ↓
READY
```

Only then:

```text
REP COMPLETE
```

---

# 51. Incomplete repetition

Example target:

```text
45°
```

Allowed:

```text
37°–53°
```

Patient:

```text
Neutral
↓
25°
↓
Neutral
```

They never entered target range.

Therefore:

```text
Incomplete Rep
```

Do not count it.

---

# 52. Rep timing

Track:

```text
repStartedAt

targetReachedAt

holdStartedAt

returnStartedAt

repCompletedAt
```

Calculate:

```text
movement-out duration

hold duration

return duration

total rep duration
```

---

# 53. Mistake engine

Examples:

### Low ROM

```text
Expected
45°

Actual
29°
```

→

```text
Bend your wrist slightly further.
```

### Stable joint movement

```text
Elbow allowed
8°

Actual deviation
15°
```

→

```text
Keep your elbow steady.
```

### Too fast

```text
Expected
3–6 seconds

Actual
1.5 seconds
```

→

```text
Slow down.
```

### Spatial issue

```text
Patient moved too close
```

→

```text
Move slightly backward.
```

---

# 54. Live patient exercise UI

Desktop:

```text
┌─────────────────────────┬──────────────────────────┐
│ REFERENCE               │ YOUR MOVEMENT            │
│                         │                          │
│    skeleton             │ camera + skeleton        │
│                         │                          │
└─────────────────────────┴──────────────────────────┘

Rep 4 / 10

Keep your elbow steady

ROM
42°

Rep Time
3.1 sec

                    Pause
```

---

# 55. Mobile exercise UI

Mobile should prioritize the patient camera.

```text
Rep 4 / 10

┌─────────────────────────────┐
│                             │
│      PATIENT CAMERA         │
│     skeleton overlay        │
│                             │
└─────────────────────────────┘

Reference
┌─────────────────────────────┐
│ animated skeleton           │
└─────────────────────────────┘

Keep your elbow steady

42° ROM     3.1 sec

          Pause
```

---

# 56. Feedback should be controlled

Don't show:

```text
Keep elbow steady
Keep elbow steady
Keep elbow steady
Keep elbow steady
```

every frame.

Add:

```text
feedback cooldown
2–3 seconds
```

and only repeat if the issue continues.

---

# 57. Skeleton overlay

Only relevant joints should receive strong visual feedback.

Example:

```text
Correct wrist
green

Incorrect elbow
orange/red
```

Don't turn the entire body red.

---

# 58. Patient session result

After completion:

```text
Exercise Complete

Right Wrist Flexion


9 / 10
Valid Repetitions

Average ROM
46°

Average Rep Time
4.1 sec

Corrections
2


Rep 4
Elbow moved

Rep 7
Range was incomplete

              Done
```

Keep it understandable.

---

# 59. Patient progress

Progress page:

```text
Wrist Flexion

This Week

Sessions
5 / 7

Average ROM
42° → 48°

Valid Reps
78% → 91%

Average Rep Time
5.2s → 4.4s
```

The patient should see improvement, not complex biomechanics.

---

# 60. Patient chat

Chat should be simple.

```text
Dr. Kumar

Today

Your wrist movement is improving.
Please keep your elbow stable.

[ Wrist Flexion Session ]

                       Thank you doctor.

Type a message...
```

---

# 61. Patient notifications

Examples:

```text
New exercise assigned

Therapist reviewed your session

New message from your therapist

Exercise schedule updated
```

---

# 62. Database domains

Conceptually:

```text
users

therapist_profiles

patient_profiles

exercises

exercise_versions

exercise_keyframes

exercise_rules

exercise_assignments

exercise_sessions

exercise_reps

exercise_errors

conversations

messages

notifications

audit_logs
```

You can embed some documents in MongoDB rather than making every concept a separate collection.

---

# 63. Exercise version example

```javascript
{
  _id,

  exerciseId,

  version: 3,

  cameraView: "RIGHT_SIDE",

  activeJoints: [
    "right_wrist"
  ],

  stableJoints: [
    "right_elbow"
  ],

  phases: [
    "READY",
    "MOVING_OUT",
    "TARGET",
    "RETURNING"
  ],

  keyframes: [...],

  rules: [...],

  status: "PUBLISHED"
}
```

---

# 64. Session model

```javascript
{
  patientId,
  therapistId,

  exerciseId,
  exerciseVersionId,

  startedAt,
  completedAt,

  expectedReps: 10,
  completedReps: 9,
  incompleteReps: 1,

  avgRepDuration: 4100,

  spatialWarnings: 2,

  reps: [...]
}
```

---

# 65. Rep model

```javascript
{
  repNumber: 4,

  durationMs: 3900,

  phases: {
    movingOut: 1200,
    hold: 900,
    returning: 1800
  },

  rom: {
    rightWrist: 46
  },

  mistakes: [
    {
      type: "ELBOW_DEVIATION",
      actual: 14,
      allowed: 8
    }
  ],

  valid: true
}
```

---

# 66. Realtime architecture

Recommended:

```text
Patient Browser

Camera
↓
MediaPipe
↓
Landmark data
↓
WebSocket
↓
FastAPI
↓
Movement Engine
↓
Tracking Result
↓
WebSocket
↓
Patient UI
```

Example incoming:

```json
{
  "type": "POSE_FRAME",
  "sessionId": "abc123",
  "timestamp": 12345,
  "landmarks": []
}
```

Response:

```json
{
  "type": "TRACKING_RESULT",

  "phase": "TARGET",

  "rep": 4,

  "feedback": "Keep your elbow steady",

  "metrics": {
    "rom": 42,
    "repTime": 3.1
  }
}
```

---

# 67. Movement Engine architecture

Keep it outside FastAPI routes.

```text
movement_engine/
│
├── pose_normalizer.py
│
├── joint_angle_engine.py
│
├── phase_detector.py
│
├── rep_engine.py
│
├── mistake_engine.py
│
├── spatial_tracker.py
│
└── feedback_engine.py
```

---

# 68. Spatial tracker

Responsible for:

```text
body centre

relative camera distance

left/right position

body orientation

out-of-frame detection

tracking confidence
```

---

# 69. Session state

Keep temporary state in Redis:

```text
currentRep

currentPhase

repStartedAt

targetReachedAt

currentErrors

lastFeedbackAt

trackingConfidence

patientPosition
```

MongoDB stores the durable result.

---

# 70. Therapist chat + patient chat architecture

```text
Patient
   ↓
WebSocket
   ↓
FastAPI
   ↓
MongoDB Messages
   ↓
WebSocket
   ↓
Therapist
```

Authorization must verify that the therapist is allowed to access that patient.

---

# 71. Notifications

Events:

```text
EXERCISE_ASSIGNED

SESSION_COMPLETED

SESSION_REVIEWED

MESSAGE_RECEIVED

EXERCISE_UPDATED
```

Notification service creates:

```text
database notification
+
realtime event
```

Later you can add:

```text
email
SMS
WhatsApp
push notification
```

without rewriting your exercise logic.

---

# 72. Design system

Your preferred visual direction works well for this product.

### Background

```text
#F8FBFF
```

with subtle:

```text
white → pale blue gradient
```

---

# 73. Primary palette

```text
Primary
#2563EB

Secondary Blue
#3B82F6

Light Blue
#DBEAFE

Surface Blue
#EFF6FF

White
#FFFFFF

Text
#0F172A

Secondary Text
#64748B

Border
#E2E8F0
```

---

# 74. Glassmorphism

Use glass only for:

```text
Header

floating skeleton tools

camera controls

feedback panels

login card

mobile bottom sheets
```

Do not make every table and card transparent.

Use white cards for normal content.

---

# 75. Typography

Use:

```text
Inter
```

Recommended:

| Element | Size |
|---|---:|
| Page title | 28–32px |
| Section | 20px |
| Card title | 16px |
| Body | 14–16px |
| Label | 13–14px |
| Helper | 12–13px |

---

# 76. Component system

Build reusable components from day one:

```text
Button

Input

Select

Slider

Modal

Drawer

BottomSheet

Toast

Card

StatusBadge

DataTable

SearchBar

Pagination

EmptyState

SkeletonCanvas

JointSelector

JointControl

MovementTimeline

ExercisePreview

CameraViewport

CalibrationStatus

RepCounter

FeedbackBanner

ChatWindow

NotificationPanel
```

This keeps the portals consistent.

---

# 77. Button hierarchy

Primary:

```text
blue gradient
```

Use only for:

```text
Create
Continue
Save
Publish
Start Exercise
```

Secondary:

```text
white + border
```

Ghost:

```text
transparent
```

Danger:

```text
red
```

only for destructive actions.

---

# 78. Responsive Therapist Portal

Desktop:

```text
Sidebar
+
Main workspace
```

Skeleton editor:

```text
Joint list
|
Large skeleton canvas
|
Properties
```

Tablet:

```text
Collapsed sidebar
+
Canvas
+
properties drawer
```

Mobile:

```text
Header
+
3D skeleton
+
timeline
+
bottom sheet
```

---

# 79. Mobile therapist skeleton editing

Do not expect a therapist to manipulate tiny 3D rotation rings.

Use:

```text
Tap Wrist
    ↓
Bottom Sheet

Right Wrist

Flexion

-60° ─────●──────── +70°

Current
42°

Save Position
```

Much easier.

---

# 80. Responsive Patient Portal

Patient UI should be mobile-first.

Use:

```text
large touch targets

44–48px buttons

simple cards

very limited text

camera as main focus
```

Desktop adds more information but should not change the workflow.

---

# 81. Privacy

Prefer:

```text
camera
↓
landmark extraction
↓
discard image frames
```

instead of storing patient videos.

Persist:

```text
angles
landmarks if required
rep timing
ROM
mistakes
session metrics
```

Raw videos should only be stored when you have a clear clinical requirement and appropriate consent.

---

# 82. Security

Production requirements:

```text
HTTPS

secure HttpOnly cookies

password hashing

role-based authorization

patient ownership checks

rate limiting

input validation

WebSocket authentication

audit logs

session expiry

refresh-token/session rotation

encrypted secrets

no credentials in frontend

API authorization on every protected resource
```

Frontend route hiding is **not security**.

---

# 83. Audit events

Record meaningful actions:

```text
THERAPIST_LOGIN

EXERCISE_CREATED

EXERCISE_VERSION_PUBLISHED

EXERCISE_ASSIGNED

PATIENT_SESSION_STARTED

PATIENT_SESSION_COMPLETED

SESSION_REVIEWED

MESSAGE_SENT
```

---

# 84. Recommended implementation sequence

I would build in this order:

| Phase | Build |
|---|---|
| **1** | Therapist login + shell |
| **2** | 3D skeleton viewer |
| **3** | Joint selection/manipulation |
| **4** | Keyframes + animation |
| **5** | Exercise save/load/versioning |
| **6** | Rules and tolerance engine |
| **7** | Patient login + exercise assignment |
| **8** | Patient camera + MediaPipe |
| **9** | Calibration + spatial tracking |
| **10** | Joint normalization + angle calculation |
| **11** | Movement phase comparison |
| **12** | Rep counting |
| **13** | Mistake detection |
| **14** | Live feedback |
| **15** | Session analytics |
| **16** | Therapist session review |
| **17** | Progress |
| **18** | Chat |
| **19** | Notifications |
| **20** | Security/hardening/testing |

---

# 85. First MVP scope

Do not start with 100 exercises.

Build the generic engine and test with around:

```text
Wrist Flexion

Elbow Flexion

Shoulder Flexion

Knee Extension

Knee Flexion
```

The important condition is:

> None of these should require developer-written exercise-specific tracking code.

The therapist should create them using:

```text
Skeleton
+
Movement
+
Rules
```

---

# 86. The core product rule

This is the architectural rule I would give your entire development team:

> **Exercises are data, not code.**

A therapist creates:

```text
joint configuration
+
keyframes
+
phases
+
tolerances
+
feedback rules
```

The generic tracking engine interprets that data.

Do not implement:

```javascript
if (exerciseName === "wrist-flexion") {
   ...
}
```

That will become impossible to maintain when you reach 100 exercises.

---

# 87. Final Therapist flow

The entire therapist experience should feel this simple:

```text
LOGIN

   ↓

DASHBOARD

   ↓

CREATE EXERCISE

   ↓

Enter name/details

   ↓

Select skeleton joints

   ↓

Set which joints move

   ↓

Set which joints remain stable

   ↓

Move skeleton to Start

   ↓

Move skeleton to Target

   ↓

Move skeleton to Return

   ↓

Preview animation

   ↓

Set simple tolerance

   ↓

Publish

   ↓

Assign Patient

   ↓

Review Patient Session

   ↓

Send Feedback / Chat
```

That's the whole therapist mental model.

---

# 88. Final Patient flow

The patient experience should be even simpler:

```text
LOGIN

   ↓

TODAY'S EXERCISES

   ↓

OPEN EXERCISE

   ↓

WATCH SKELETON

   ↓

START CAMERA

   ↓

POSITION YOURSELF

   ↓

READY

   ↓

FOLLOW SKELETON

   ↓

LIVE CORRECTIONS

   ↓

REP 1
REP 2
REP 3
...

   ↓

EXERCISE COMPLETE

   ↓

SEE SIMPLE RESULT

   ↓

THERAPIST REVIEWS

   ↓

MESSAGE IF REQUIRED
```

That simplicity is important. **The therapist creates motion, not algorithms. The patient performs motion, not measurements. The software handles all the technical complexity in between.**

This is the architecture I would use as the definitive baseline for building the product.