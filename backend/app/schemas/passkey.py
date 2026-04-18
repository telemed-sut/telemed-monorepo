from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

class PasskeyRegistrationOptionsResponse(BaseModel):
    # This matches the options object needed by @simplewebauthn/browser
    rp: dict
    user: dict
    challenge: str
    pubKeyCredParams: List[dict]
    timeout: int
    excludeCredentials: List[dict] = Field(default_factory=list)
    authenticatorSelection: dict
    attestation: str
    temp_sid: str

class PasskeyRegistrationVerifyRequest(BaseModel):
    name: Optional[str] = None  # Friendly name for the device
    registration_response: dict  # The object returned by @simplewebauthn/browser

class PasskeyAuthenticationOptionsResponse(BaseModel):
    challenge: str
    timeout: int
    rpId: str
    allowCredentials: List[dict] = Field(default_factory=list)
    userVerification: str
    temp_sid: str

class PasskeyAuthenticationVerifyRequest(BaseModel):
    authentication_response: dict  # The object returned by @simplewebauthn/browser

class PasskeyOut(BaseModel):
    id: str
    name: Optional[str] = None
    created_at: datetime
    last_used_at: Optional[datetime] = None

class PasskeyListResponse(BaseModel):
    items: List[PasskeyOut]
    total: int
