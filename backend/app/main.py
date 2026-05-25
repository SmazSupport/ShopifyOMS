from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import health
from app.routers import status
from app.routers import auth
from app.routers import orders
from app.routers import products
from app.routers import fields

app = FastAPI(
    title="OMS API",
    description="Order Management System",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(status.router)
app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(products.router)
app.include_router(fields.router)
