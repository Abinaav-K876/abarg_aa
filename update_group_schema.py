from app import app, db
from models import Group
from sqlalchemy import text

with app.app_context():
    try:
        # Check if column exists (simple way for sqlite)
        with db.engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(group)"))
            columns = [row[1] for row in result.fetchall()]
            if 'image_url' not in columns:
                print("Adding image_url to Group table...")
                conn.execute(text("ALTER TABLE `group` ADD COLUMN image_url VARCHAR(255)"))
                conn.commit()
            else:
                print("image_url already exists.")
    except Exception as e:
        print(f"Error: {e}")
