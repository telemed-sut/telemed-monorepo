from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: UserRole

    model_config = {"from_attributes": True}
