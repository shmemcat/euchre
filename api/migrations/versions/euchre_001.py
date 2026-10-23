"""Adopt verified legacy Euchre tables or provision fresh game-owned tables."""

from datetime import datetime
import json
import uuid

from alembic import op
from sqlalchemy import (
    Column,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    Table,
    inspect,
    select,
    text,
)

revision = "euchre_001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    from euchre_server.models import EuchreGameResult, EuchreTable
    from euchre_server.game_accounts import receipts, versions, _scrub_euchre
    from euchre_server.euchre_multiplayer import captains, migrate_host

    connection = op.get_bind()
    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    if "users" not in existing:
        raise RuntimeError(
            "Provision the shared account schema first; Euchre never owns users"
        )
    owned = {"euchre_game_results", "euchre_tables"}
    if owned & existing:
        if (
            "alembic_version" not in existing
            or connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
            != "019"
        ):
            raise RuntimeError(
                "Existing game tables require the verified legacy revision 019"
            )
    for model in (EuchreGameResult, EuchreTable):
        table = model.__table__
        if table.name in existing:
            columns = {column["name"] for column in inspector.get_columns(table.name)}
            if not set(table.columns.keys()) <= columns:
                raise RuntimeError(
                    "Existing Euchre columns are incompatible; no data was replaced"
                )
        elif model is EuchreGameResult:
            # FK metadata is used only for migration DDL. There is no runtime User model.
            migration_metadata = MetaData()
            Table("users", migration_metadata, Column("id", Integer, primary_key=True))
            migrated = table.to_metadata(migration_metadata)
            migrated.append_constraint(
                ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE")
            )
            migrated.create(connection)
        else:
            table.create(connection)
    inspector = inspect(connection)
    constraints = inspector.get_unique_constraints("euchre_game_results")
    if not any(
        value["column_names"] == ["user_id", "game_id"] for value in constraints
    ):
        raise RuntimeError(
            "The existing account/game result deduplication constraint must be verified"
        )
    foreign_keys = inspector.get_foreign_keys("euchre_game_results")
    if not any(
        value["constrained_columns"] == ["user_id"]
        and value["referred_table"] == "users"
        and value["referred_columns"] == ["id"]
        and value.get("options", {}).get("ondelete", "").upper() == "CASCADE"
        for value in foreign_keys
    ):
        raise RuntimeError("The shared account foreign key must be verified")
    for table in (receipts["euchre"], versions["euchre"]):
        table.create(connection, checkfirst=True)
    current = connection.execute(select(versions["euchre"].c.version)).scalar()
    if current is None:
        connection.execute(
            versions["euchre"].insert().values(version="game_accounts_001")
        )
    elif current != "game_accounts_001":
        raise RuntimeError("Unsupported account cleanup schema")
    # Repair orphaned legacy JSON references using migration-role access only.
    # No account names, password hashes, sessions, or signing secrets are read.
    valid_ids = set(connection.execute(text("SELECT id FROM users")).scalars())
    for row in connection.execute(select(EuchreTable.__table__)).mappings():
        snapshot = json.loads(row["snapshot"])
        members = [member for member in snapshot.get("seats", []) if member]
        members += list(snapshot.get("unseated", {}).values()) + snapshot.get(
            "participants", []
        )
        orphan_ids = {
            member["userId"] for member in members if member.get("userId")
        } - valid_ids
        for user_id in orphan_ids:
            _scrub_euchre(snapshot, user_id)
            if not connection.execute(
                select(receipts["euchre"].c.user_id).where(
                    receipts["euchre"].c.user_id == user_id
                )
            ).first():
                connection.execute(
                    receipts["euchre"]
                    .insert()
                    .values(
                        user_id=user_id,
                        request_id=uuid.uuid4().hex,
                        deleted_at=datetime.utcnow(),
                    )
                )
        if orphan_ids:
            captains(snapshot)
            migrate_host(snapshot)
            snapshot["revision"] += 1
            connection.execute(
                EuchreTable.__table__.update()
                .where(EuchreTable.code == row["code"])
                .values(snapshot=json.dumps(snapshot))
            )


def downgrade():
    raise RuntimeError(
        "Keep game data and deletion receipts; use an additive forward migration"
    )
