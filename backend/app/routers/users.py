from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.utils.auth import get_current_user, hash_password
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


class UserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str]
    is_active: bool
    is_superuser: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: str
    full_name: Optional[str] = None
    password: str
    is_superuser: bool = False


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None
    password: Optional[str] = None


@router.get("", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser only")
    result = await db.execute(select(User).order_by(User.email))
    return result.scalars().all()


@router.post("", response_model=UserOut)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser only")
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")
    user = User(
        email=data.email,
        full_name=data.full_name,
        hashed_password=hash_password(data.password),
        is_active=True,
        is_superuser=data.is_superuser,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superuser and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.is_active is not None and current_user.is_superuser:
        user.is_active = data.is_active
    if data.is_superuser is not None and current_user.is_superuser:
        user.is_superuser = data.is_superuser
    if data.password:
        user.hashed_password = hash_password(data.password)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser only")
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"deleted": user_id}
