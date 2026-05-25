from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, func
from app.database import get_db
from app.models.shop import Shop
from app.models.order import Order
from app.models.product import Product, Variant
from app.models.customer import Customer
from app.models.line_item import LineItem

router = APIRouter(prefix="/status", tags=["status"])


@router.get("")
async def system_status(db: AsyncSession = Depends(get_db)):
    db_ok = False
    db_error = None
    counts = {}

    try:
        await db.execute(text("SELECT 1"))
        db_ok = True

        for label, model in [
            ("shops", Shop),
            ("orders", Order),
            ("line_items", LineItem),
            ("products", Product),
            ("variants", Variant),
            ("customers", Customer),
        ]:
            result = await db.execute(select(func.count()).select_from(model))
            counts[label] = result.scalar()

    except Exception as e:
        db_error = str(e)

    return {
        "api": "ok",
        "database": "ok" if db_ok else "error",
        "db_error": db_error,
        "table_counts": counts,
    }
