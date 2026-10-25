from datetime import datetime
from euchre_server.extensions import db


class EuchreGameResult(db.Model):
    __tablename__ = "euchre_game_results"

    id = db.Column(db.Integer, primary_key=True)
    # The migration preserves the account FK; runtime metadata has no User model.
    user_id = db.Column(
        db.Integer,
        nullable=False,
        index=True,
    )
    game_id = db.Column(db.String(64), nullable=False)
    difficulty = db.Column(db.String(16), nullable=False)
    won = db.Column(db.Boolean, nullable=False)
    conceded = db.Column(db.Boolean, nullable=False)
    score = db.Column(db.Integer, nullable=False)
    opponent_score = db.Column(db.Integer, nullable=False)
    completed_at = db.Column(db.DateTime, nullable=False)
    recorded_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    marches = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    loners = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    euchres = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    achievement_data = db.Column(db.JSON, nullable=True)

    __table_args__ = (
        db.UniqueConstraint(
            "user_id", "game_id", name="uq_euchre_game_result_user_game"
        ),
        db.Index(
            "ix_euchre_results_category_completed", "difficulty", "won", "completed_at"
        ),
    )


class EuchreTable(db.Model):
    __tablename__ = "euchre_tables"

    code = db.Column(db.String(6), primary_key=True)
    snapshot = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class EuchreAchievementState(db.Model):
    __tablename__ = "euchre_achievement_state"

    user_id = db.Column(db.Integer, primary_key=True)
    unlocks = db.Column(db.JSON, nullable=False, default=list)
