"""Explicit Euchre migration job; game workers only check schema readiness."""

from pathlib import Path
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import SQLAlchemyError
from euchre_server.extensions import db

REVISION = "euchre_001"


def schema_ready():
    from euchre_server.models import EuchreGameResult, EuchreTable
    from euchre_server.game_accounts import receipts, versions

    try:
        inspector = inspect(db.engine)
        required = {
            "euchre_game_results",
            "euchre_tables",
            "euchre_account_deletions",
            "euchre_account_schema_version",
            "euchre_alembic_version",
        }
        if not required <= set(inspector.get_table_names()):
            return False
        for table in (
            EuchreGameResult.__table__,
            EuchreTable.__table__,
            receipts["euchre"],
            versions["euchre"],
        ):
            if not set(table.columns.keys()) <= {
                column["name"] for column in inspector.get_columns(table.name)
            }:
                return False
        return (
            db.session.execute(
                text("SELECT version_num FROM euchre_alembic_version")
            ).scalar()
            in ("euchre_001", "euchre_002")
            and db.session.execute(select(versions["euchre"].c.version)).scalar()
            == "game_accounts_001"
        )
    except SQLAlchemyError:
        db.session.rollback()
        return False


def upgrade_schema():
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parent.parent / "migrations")
    )
    with db.engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(61349201003)"))
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


if __name__ == "__main__":
    from euchre_server import create_app

    app = create_app()
    with app.app_context():
        if sys.argv[1:] == ["upgrade"]:
            upgrade_schema()
        elif sys.argv[1:] == ["check"]:
            raise SystemExit(0 if schema_ready() else 1)
        else:
            raise SystemExit("Use upgrade or check")
