"""add car home location

Every car has a home airport. Existing cars get the airport they are at now.

Revision ID: b3d5f7a9c1e2
Revises: a9c1e3f5b7d0
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b3d5f7a9c1e2'
down_revision: Union[str, Sequence[str], None] = 'a9c1e3f5b7d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('cars', sa.Column('home_location_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE cars SET home_location_id = current_location_id")
    op.alter_column('cars', 'home_location_id', nullable=False)
    op.create_foreign_key(
        'fk_cars_home_location_id_locations',
        'cars',
        'locations',
        ['home_location_id'],
        ['id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_cars_home_location_id_locations', 'cars', type_='foreignkey')
    op.drop_column('cars', 'home_location_id')
