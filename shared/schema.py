from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ViolationType(str, Enum):
    lane_block = "lane_block"
    no_helmet = "no_helmet"
    triple_riding = "triple_riding"
    illegal_parking = "illegal_parking"
    wrong_side_driving = "wrong_side_driving"


class BBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


# one detected object from the vision model before rule logic
class Detection(BaseModel):
    label: str
    confidence: float
    box: BBox
    ocr_text: Optional[str] = None


# the core contract both halves agree on
class ViolationEvent(BaseModel):
    event_id: str
    violation_type: ViolationType
    confidence: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # location context, filled from the camera or a demo tag
    corridor: Optional[str] = None
    junction: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    # evidence
    plate_text: Optional[str] = None
    annotated_image_path: Optional[str] = None
    detections: list[Detection] = []


# what the forecaster returns for a lane_block event
class ImpactForecast(BaseModel):
    event_id: str
    severity: str
    severity_confidence: float
    closure_probability: float
    expected_clearance_minutes: float
    clearance_low: float
    clearance_high: float


# the deployment plan from the recommender
class Recommendation(BaseModel):
    event_id: str
    officers: int
    barricade: bool
    diversion_note: str
    rationale: str


# one row of the learn loop
class FeedbackRecord(BaseModel):
    event_id: str
    predicted_clearance_minutes: float
    actual_clearance_minutes: float
    predicted_severity: str
    actual_severity: str
    logged_at: datetime = Field(default_factory=datetime.utcnow)
