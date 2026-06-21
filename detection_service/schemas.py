"""Response/request schemas for the detection service.

These Pydantic models define the public contract. They drive the OpenAPI
docs at /docs, so any consumer can see the exact shape of every field.
"""

from pydantic import BaseModel, Field


class BBox(BaseModel):
    x1: float = Field(..., description="Left edge, pixels in the original image")
    y1: float = Field(..., description="Top edge, pixels in the original image")
    x2: float = Field(..., description="Right edge, pixels in the original image")
    y2: float = Field(..., description="Bottom edge, pixels in the original image")


class Detection(BaseModel):
    label: str = Field(
        ...,
        description="Detected class: car, truck, bus, motorcycle_rider, bicycle, "
        "person, helmet, no_helmet, or license_plate",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)
    box: BBox
    ocr_text: str | None = Field(
        None, description="Recognized plate text; only set for license_plate"
    )


class ViolationEvent(BaseModel):
    event_id: str
    violation_type: str = Field(..., description="lane_block or no_helmet")
    confidence: float = Field(..., ge=0.0, le=1.0)
    created_datetime: str | None = Field(None, description="UTC ISO timestamp")
    plate_confidence: float | None = None
    corridor: str | None = None
    junction: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    plate_text: str | None = None
    annotated_image_path: str | None = None
    detections: list[Detection] = Field(
        default_factory=list, description="The detection(s) backing this event"
    )


class DetectResponse(BaseModel):
    events: list[ViolationEvent] = Field(
        ..., description="Violations inferred from the detections by the rules engine"
    )
    raw_detections: list[Detection] = Field(
        ..., description="Every object the detector returned, unfiltered"
    )


class NoParkingZone(BaseModel):
    """Optional rectangle (image pixels) marking the no-parking area."""

    x1: float
    y1: float
    x2: float
    y2: float


class HealthResponse(BaseModel):
    ok: bool
    ready: bool = Field(..., description="True once the detector model is loaded")
    detector: str | None = Field(None, description="Active backend class name")
    version: str
    error: str | None = Field(None, description="Set if the detector failed to load")


class CapabilitiesResponse(BaseModel):
    detector: str | None
    violation_types: list[str]
    labels: list[str]
    version: str
