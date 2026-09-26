"""add other-language wording to extras

Revision ID: c9e1a3b5d7f9
Revises: b8d0f2a4c6e8
Create Date: 2026-10-01 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c9e1a3b5d7f9'
down_revision: Union[str, None] = 'b8d0f2a4c6e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STARTING_EXTRAS = {
    "ADDITIONAL_DRIVER": {
        "it": {"name": "Guidatore aggiuntivo", "description": "Registra un secondo guidatore nel contratto di noleggio."},
        "pl": {"name": "Dodatkowy kierowca", "description": "Wpisz drugiego kierowcę do umowy najmu."},
    },
    "REFUELING_SERVICE": {
        "it": {"name": "Servizio di rifornimento", "description": "Riconsegna l’auto con qualsiasi livello di carburante: ci pensiamo noi al pieno."},
        "pl": {"name": "Usługa tankowania", "description": "Zwróć samochód z dowolnym poziomem paliwa, a my go zatankujemy."},
    },
    "PASSENGER_INSURANCE": {
        "it": {"name": "Assicurazione infortuni passeggeri", "description": "Copertura medica e infortuni per il conducente e tutti i passeggeri."},
        "pl": {"name": "Ubezpieczenie NNW pasażerów", "description": "Ochrona medyczna i od następstw wypadków dla kierowcy i wszystkich pasażerów."},
    },
    "INTERIOR_COVERAGE": {
        "it": {"name": "Copertura danni agli interni", "description": "Esclude gli addebiti per macchie, strappi e bruciature negli interni."},
        "pl": {"name": "Ochrona wnętrza pojazdu", "description": "Zwalnia z opłat za plamy, rozdarcia i przypalenia we wnętrzu."},
    },
    "BABY_SEAT": {
        "it": {"name": "Seggiolino per neonati", "description": "Seggiolino in senso contrario alla marcia per neonati fino a 13 kg."},
        "pl": {"name": "Fotelik niemowlęcy", "description": "Fotelik tyłem do kierunku jazdy dla niemowląt do 13 kg."},
    },
    "CHILD_SEAT": {
        "it": {"name": "Seggiolino per bambini", "description": "Seggiolino in senso di marcia per bambini da 9 a 36 kg."},
        "pl": {"name": "Fotelik dziecięcy", "description": "Fotelik przodem do kierunku jazdy dla dzieci od 9 do 36 kg."},
    },
}


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'extras',
        sa.Column(
            'translations',
            postgresql.JSONB(),
            nullable=False,
            server_default='{}',
        ),
    )

    # Italian and Polish wording for the extras a new stack starts with. Only
    # a row still without any wording is touched, and a business that has
    # renamed one of these keeps its own English name as the fallback.
    connection = op.get_bind()

    for code, wording in _STARTING_EXTRAS.items():
        connection.execute(
            sa.text(
                "UPDATE extras SET translations = CAST(:wording AS jsonb) "
                "WHERE code = :code AND translations = '{}'::jsonb"
            ),
            {"code": code, "wording": json.dumps(wording, ensure_ascii=False)},
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('extras', 'translations')
