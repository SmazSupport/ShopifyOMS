import asyncio
import random
from datetime import datetime, timedelta, timezone
from app.database import AsyncSessionLocal, engine
from app.models import Shop, Customer, Order, LineItem, Product, Variant
from app.models.user import User
from app.utils.auth import hash_password


SKUS = [
    ("PROD-001", "Product Alpha", 34.99),
    ("PROD-002", "Product Beta", 44.99),
    ("PROD-003", "Product Gamma", 29.99),
    ("PROD-004", "Product Delta", 29.99),
    ("PROD-005", "Product Epsilon", 34.99),
    ("PROD-006", "Product Zeta", 29.99),
    ("PROD-007", "Accessory One", 24.99),
    ("PROD-008", "Accessory Two", 19.99),
]

# Bin location configuration
BIN_SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "S"]
BIN_ROWS = ["A", "B", "C"]

# Dimension profiles for shipping calculations
DIMENSION_PROFILES = [
    {
        "name": "common",
        "length": 6.5,
        "width": 6.0,
        "height": 2.5,
        "shipping_unit": 1.0,
        "weight_oz": 4.0,
        "grams": 113,
    },
    {
        "name": "small",
        "length": 5.5,
        "width": 5.0,
        "height": 0.5,
        "shipping_unit": 0.2,
        "weight_oz": 0.7,
        "grams": 20,
    },
    {
        "name": "large",
        "length": 10.0,
        "width": 8.0,
        "height": 5.0,
        "shipping_unit": 3.5,
        "weight_oz": 6.0,
        "grams": 170,
    },
]

FIRST_NAMES = ["Emma", "Liam", "Olivia", "Noah", "Ava", "James", "Sophia", "William"]
LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis"]

STATES = [
    {"name": "New York", "code": "NY"},
    {"name": "California", "code": "CA"},
    {"name": "Texas", "code": "TX"},
    {"name": "Florida", "code": "FL"},
    {"name": "Illinois", "code": "IL"},
]

ORDER_STATUSES = ["open", "open", "open", "fulfilled", "fulfilled", "on_hold", "cancelled"]
FULFILLMENT_STATUSES = ["unfulfilled", "unfulfilled", "partial", "fulfilled", None]
FINANCIAL_STATUSES = ["paid", "paid", "paid", "pending", "refunded"]


def random_shopify_id():
    return str(random.randint(1000000000000, 9999999999999))


def generate_bin_number() -> str:
    """Generate a random bin number (e.g., B7A, S12C)"""
    section = random.choice(BIN_SECTIONS)
    column = random.randint(1, 15)
    row = random.choice(BIN_ROWS)
    return f"{section}{column}{row}"


def get_dimension_profile() -> dict:
    """Get a random dimension profile with weighted distribution"""
    # Weight: common (60%), small (30%), large (10%)
    weights = [0.6, 0.3, 0.1]
    return random.choices(DIMENSION_PROFILES, weights=weights)[0]


def random_date(days_back=90):
    delta = timedelta(days=random.randint(0, days_back), hours=random.randint(0, 23))
    return datetime.now(timezone.utc) - delta


async def seed():
    async with AsyncSessionLocal() as db:
        # --- Admin user ---
        from sqlalchemy import select
        existing = await db.execute(select(User).where(User.email == "admin@oms.local"))
        if not existing.scalar_one_or_none():
            admin = User(
                email="admin@oms.local",
                full_name="OMS Admin",
                hashed_password=hash_password("Admin123"),
                is_active=True,
                is_superuser=True,
            )
            db.add(admin)
            print("Created admin user: admin@oms.local / Admin123")
        else:
            print("Admin user already exists")

        # --- Shop ---
        existing_shop = await db.execute(select(Shop).where(Shop.shopify_domain == "demo-store.myshopify.com"))
        shop = existing_shop.scalar_one_or_none()
        if not shop:
            shop = Shop(
                tenant_id="demo-001",
                shopify_domain="demo-store.myshopify.com",
                name="Demo Store",
                access_token="mock_token_not_real",
                is_active=True,
            )
            db.add(shop)
            await db.flush()
            print(f"Created shop: {shop.name}")
        else:
            print("Shop already exists")

        # --- Products + Variants ---
        products = []
        for sku, title, price in SKUS:
            existing_prod = await db.execute(select(Product).where(Product.handle == sku.lower()))
            product = existing_prod.scalar_one_or_none()
            if not product:
                product = Product(
                    shop_id=shop.id,
                    shopify_product_id=random_shopify_id(),
                    title=title,
                    handle=sku.lower(),
                    product_type="Product" if sku.startswith("PROD") else "Accessory",
                    vendor="Demo Vendor",
                )
                db.add(product)
                await db.flush()

            # Check if variant exists, create or update with metafields and dimensions
            existing_var = await db.execute(select(Variant).where(Variant.sku == sku))
            variant = existing_var.scalar_one_or_none()
            
            # Generate variant data with metafields and dimensions
            profile = get_dimension_profile()
            bin_number = generate_bin_number()
            
            if not variant:
                variant = Variant(
                    product_id=product.id,
                    shopify_variant_id=random_shopify_id(),
                    sku=sku,
                    title="Default Title",
                    price=str(price),
                    inventory_quantity=str(random.randint(10, 200)),
                )
                db.add(variant)
            
            # Always update these fields (for existing or new variants)
            variant.grams = profile["grams"]
            variant.weight = profile["weight_oz"]
            variant.weight_unit = "oz"
            variant.length = profile["length"]
            variant.width = profile["width"]
            variant.height = profile["height"]
            variant.shipping_unit = profile["shipping_unit"]
            variant.metafields = {
                "custom": {
                    "bin_number": bin_number,
                    "bin_section": bin_number[0],
                    "bin_column": int(bin_number[1:-1]),
                    "bin_row": bin_number[-1],
                }
            }
            await db.flush()
            products.append((product, sku, title, price))

        print(f"Products seeded: {len(products)}")

        # --- Update ALL existing variants with metafields/dimensions if missing ---
        all_variants_result = await db.execute(select(Variant))
        all_variants = all_variants_result.scalars().all()
        updated_count = 0
        for variant in all_variants:
            # Check if metafields is None, empty, or missing custom.bin_number
            needs_update = (
                variant.metafields is None or 
                not isinstance(variant.metafields, dict) or
                not variant.metafields.get("custom", {}).get("bin_number") or
                variant.length is None or
                variant.shipping_unit is None
            )
            if needs_update:
                profile = get_dimension_profile()
                bin_number = generate_bin_number()
                variant.grams = profile["grams"]
                variant.weight = profile["weight_oz"]
                variant.weight_unit = "oz"
                variant.length = profile["length"]
                variant.width = profile["width"]
                variant.height = profile["height"]
                variant.shipping_unit = profile["shipping_unit"]
                variant.metafields = {
                    "custom": {
                        "bin_number": bin_number,
                        "bin_section": bin_number[0],
                        "bin_column": int(bin_number[1:-1]),
                        "bin_row": bin_number[-1],
                    }
                }
                updated_count += 1
        if updated_count > 0:
            await db.flush()
            print(f"Updated {updated_count} variants with metafields/dimensions")
        print(f"Total variants in database: {len(all_variants)}")

        # --- Customers + Orders ---
        order_count = 0
        for i in range(40):
            first = random.choice(FIRST_NAMES)
            last = random.choice(LAST_NAMES)
            email = f"{first.lower()}.{last.lower()}{random.randint(1,99)}@example.com"
            state = random.choice(STATES)

            customer = Customer(
                shop_id=shop.id,
                shopify_customer_id=random_shopify_id(),
                email=email,
                first_name=first,
                last_name=last,
            )
            db.add(customer)
            await db.flush()

            num_orders = random.randint(1, 3)
            for _ in range(num_orders):
                num_items = random.randint(1, 4)
                selected = random.sample(products, min(num_items, len(products)))
                total = sum(price for _, _, _, price in selected)
                tags = random.sample(["wholesale", "vip", "gift", "bundle", "repeat-customer"], k=random.randint(0, 2))
                order_date = random_date(90)

                order = Order(
                    shop_id=shop.id,
                    customer_id=customer.id,
                    shopify_order_id=random_shopify_id(),
                    order_number=f"#{random.randint(1001, 9999)}",
                    status=random.choice(ORDER_STATUSES),
                    fulfillment_status=random.choice(FULFILLMENT_STATUSES),
                    financial_status=random.choice(FINANCIAL_STATUSES),
                    total_price=round(total, 2),
                    currency="USD",
                    tags=tags,
                    shipping_address={
                        "first_name": first,
                        "last_name": last,
                        "address1": f"{random.randint(100,9999)} Main St",
                        "city": "Springfield",
                        "province": state["name"],
                        "province_code": state["code"],
                        "zip": f"{random.randint(10000,99999)}",
                        "country": "United States",
                        "country_code": "US",
                        "phone": f"555-{random.randint(100,999)}-{random.randint(1000,9999)}",
                    },
                    item_count=sum(1 for _ in selected),
                )
                db.add(order)
                await db.flush()

                for product, sku, title, price in selected:
                    result = await db.execute(
                        select(Variant).where(Variant.product_id == product.id)
                    )
                    variant = result.scalar_one_or_none()
                    line = LineItem(
                        order_id=order.id,
                        shopify_line_item_id=random_shopify_id(),
                        sku=sku,
                        product_title=title,
                        variant_title="Default Title",
                        quantity=random.randint(1, 2),
                        price=price,
                        variant_id=variant.id if variant else None,
                    )
                    db.add(line)

                order_count += 1

        await db.commit()
        print(f"Seeded {order_count} orders with line items")
        print("\nDone! Login at: admin@oms.local / Admin123")


if __name__ == "__main__":
    asyncio.run(seed())
