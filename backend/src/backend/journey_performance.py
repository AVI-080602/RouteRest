from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt


class RestScoreInput(BaseModel):
    """One planned rest and its recorded actual duration."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    required_minutes: float = Field(gt=0)
    actual_minutes: float | None = Field(ge=0)


class JourneyPerformanceRequest(BaseModel):
    """Inputs for calculating one completed journey's performance."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    journey_id: UUID
    status: Literal["completed"]
    rests: list[RestScoreInput]
    checks: list[StrictBool | None] = Field(min_length=1)
    previous_total: float = Field(ge=0)
    previous_count: StrictInt = Field(ge=0)