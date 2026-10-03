from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class Role(str, Enum):
    therapist = "THERAPIST"
    patient = "PATIENT"


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class TherapistSetupInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=12, max_length=256)


class PatientInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=12, max_length=256)
    focus: str = Field(default="", max_length=160)


class Frame(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    angles: dict[str, float]


class Rules(BaseModel):
    tolerance: float = Field(default=8, ge=0, le=45)
    stable: float = Field(default=8, ge=0, le=45)
    minTime: float = Field(default=2, ge=0, le=60)
    maxTime: float = Field(default=6, gt=0, le=120)
    feedback: str = Field(default="Move a little further.", max_length=240)

    @model_validator(mode="after")
    def check_time(self):
        if self.maxTime <= self.minTime:
            raise ValueError("Maximum movement time must exceed minimum time")
        return self


JOINT_LIMITS = {"shoulder": (-30, 170), "elbow": (0, 150), "wrist": (-70, 80), "hip": (-20, 120), "knee": (0, 140), "ankle": (-30, 45)}
REGIONS = {"Wrist / Hand", "Elbow", "Shoulder", "Hip", "Knee", "Ankle"}


class ExerciseInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    region: str
    side: Literal["Right", "Left", "Both"]
    movementPlane: Literal["frontal", "sagittal"] = "frontal"
    reps: int = Field(ge=1, le=50)
    hold: float = Field(ge=0, le=30)
    camera: Literal["Front", "Right side", "Left side", "Back"]
    instruction: str = Field(min_length=1, max_length=500)
    roles: dict[str, Literal["active", "stable", "observe"]]
    frames: list[Frame] = Field(max_length=20)
    rules: Rules
    version: int = Field(default=1, ge=1)
    supersedesId: str | None = None
    patientIds: list[str] = Field(default_factory=list, max_length=100)
    status: Literal["Draft", "Published"] = "Draft"

    @field_validator("region")
    @classmethod
    def valid_region(cls, value):
        if value not in REGIONS:
            raise ValueError("Unknown body region")
        return value

    @model_validator(mode="after")
    def validate_exercise(self):
        for joint in self.roles:
            side, separator, kind = joint.partition("_")
            if not separator or side not in {"left", "right"} or kind not in JOINT_LIMITS:
                raise ValueError(f"Unsupported joint: {joint}")
        for frame in self.frames:
            for joint, angle in frame.angles.items():
                if joint not in self.roles:
                    raise ValueError(f"Frame uses unselected joint: {joint}")
                low, high = JOINT_LIMITS[joint.split("_", 1)[1]]
                if not low <= angle <= high:
                    raise ValueError(f"Angle for {joint} is outside the supported range")
        if self.status == "Published":
            active = [joint for joint, role in self.roles.items() if role == "active"]
            if len(self.frames) < 3 or not active:
                raise ValueError("Publishing requires active joints and Start, Target, Return positions")
            start, target, end = self.frames[:3]
            if not all(j in start.angles and j in target.angles and j in end.angles and abs(target.angles[j] - start.angles[j]) >= 5 for j in active):
                raise ValueError("Each active joint needs a saved Start, Target, and Return movement")
            if any(abs(end.angles.get(j, 0) - start.angles.get(j, 0)) > 10 for j in active):
                raise ValueError("Return position must be close to Start")
        return self


class AssignmentInput(BaseModel):
    exerciseId: str
    patientId: str


class MotionSample(BaseModel):
    timeMs: int = Field(ge=0, le=3_600_000)
    angles: dict[str, float]
    visible: bool = True


class SessionInput(BaseModel):
    exerciseId: str
    samples: list[MotionSample] = Field(min_length=5, max_length=2400)


class MessageInput(BaseModel):
    patientId: str | None = None
    text: str = Field(min_length=1, max_length=2000)
