"""vehicle classes

Revision ID: b8d0e2f4a6c9
Revises: a7c9d1e3f5b8
Create Date: 2026-10-11 00:00:00.000000

A class groups cars that are rented out alike at one daily price. Cars get a
class_id. Existing cars are grouped by (category, price): each group becomes a
class named from its category, so nothing changes for anyone until the business
renames and regroups them in Configuration > Classes.
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b8d0e2f4a6c9'
down_revision: Union[str, None] = 'a7c9d1e3f5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NAMES = {
    "ECONOMY": ("Economy", "Economica", "Ekonomiczna"),
    "COMPACT": ("Compact", "Compatta", "Kompaktowa"),
    "MIDSIZE": ("Midsize", "Media", "Średnia"),
    "PREMIUM": ("Premium", "Premium", "Premium"),
    "SUV": ("SUV", "SUV", "SUV"),
    "VAN": ("Van", "Furgone", "Van"),
    None: ("Standard", "Standard", "Standard"),
}


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'vehicle_classes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('slug', sa.String(length=80), nullable=False, unique=True),
        sa.Column('name', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('description', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('price_per_day', sa.Numeric(10, 2), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('offered_online', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('price_per_day >= 0', name='vehicle_class_price_not_negative'),
    )

    op.add_column('cars', sa.Column('class_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_cars_class_id', 'cars', 'vehicle_classes', ['class_id'], ['id'])
    op.create_index('ix_cars_class_id', 'cars', ['class_id'])

    connection = op.get_bind()
    groups = connection.execute(
        sa.text("SELECT category, price_per_day, bool_or(offered_online) FROM cars GROUP BY category, price_per_day ORDER BY category NULLS LAST, price_per_day")
    ).all()

    per_category: dict = {}

    for category, _price, _online in groups:
        per_category[category] = per_category.get(category, 0) + 1

    used: set[str] = set()

    for position, (category, price, online) in enumerate(groups):
        en, it, pl = NAMES.get(category, (str(category).title(),) * 3)
        suffix = f" {price:.2f}" if per_category[category] > 1 else ""
        base = re.sub(r"[^a-z0-9]+", "-", (en + suffix).lower()).strip("-") or "class"
        slug, n = base, 2

        while slug in used:
            slug, n = f"{base}-{n}", n + 1

        used.add(slug)

        class_id = connection.execute(
            sa.text(
                "INSERT INTO vehicle_classes (id, slug, name, description, price_per_day, sort_order, offered_online) "
                "VALUES (gen_random_uuid(), :slug, CAST(:name AS jsonb), '{}'::jsonb, :price, :order, :online) RETURNING id"
            ),
            {
                "slug": slug,
                "name": __import__("json").dumps({"en": en + suffix, "it": it + suffix, "pl": pl + suffix}),
                "price": price,
                "order": position,
                "online": bool(online),
            },
        ).scalar_one()

        connection.execute(
            sa.text("UPDATE cars SET class_id = :class_id WHERE category IS NOT DISTINCT FROM :category AND price_per_day = :price"),
            {"class_id": class_id, "category": category, "price": price},
        )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_cars_class_id', table_name='cars')
    op.drop_constraint('fk_cars_class_id', 'cars', type_='foreignkey')
    op.drop_column('cars', 'class_id')
    op.drop_table('vehicle_classes')
