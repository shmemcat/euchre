from pathlib import Path
from sqlalchemy import text
from euchre_server import schema
from euchre_server.extensions import db

def test_compatible_release_is_ready_after_the_additive_upgrade(app):
    assert Path(schema.__file__).resolve().is_relative_to(Path(__file__).resolve().parents[1])
    with app.app_context():
        assert schema.schema_ready()
        db.session.execute(text("UPDATE euchre_alembic_version SET version_num='euchre_002'"))
        db.session.commit()
        assert schema.schema_ready()
