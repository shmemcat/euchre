"""Persist achievement evidence and account settings unlocks."""

from alembic import op
import sqlalchemy as sa

revision = "euchre_002"
down_revision = "euchre_001"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "achievement_data" not in {
        c["name"] for c in inspector.get_columns("euchre_game_results")
    }:
        op.add_column(
            "euchre_game_results",
            sa.Column("achievement_data", sa.JSON(), nullable=True),
        )
    if "euchre_achievement_state" in inspector.get_table_names():
        return
    op.create_table(
        "euchre_achievement_state",
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("unlocks", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )


def downgrade():
    raise RuntimeError(
        "Preserve earned achievements; use an additive forward migration"
    )
