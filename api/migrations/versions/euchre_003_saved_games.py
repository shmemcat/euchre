"""Account-owned bot games that can be resumed on another device."""
from alembic import op
import sqlalchemy as sa

revision = "euchre_003"
down_revision = "euchre_002"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "euchre_saved_games" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("euchre_saved_games")}
        if not {"game_id", "user_id", "game", "revision", "updated_at"} <= columns:
            raise RuntimeError("Incompatible saved game schema")
        return
    op.create_table(
        "euchre_saved_games",
        sa.Column("game_id", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("game", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_euchre_saved_games_user_id", "euchre_saved_games", ["user_id"])


def downgrade():
    raise RuntimeError("Preserve saved games; use an additive forward migration")
