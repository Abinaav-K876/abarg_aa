from app import app, db
from sqlalchemy import text

with app.app_context():
    try:
        with db.engine.connect() as conn:
            # Check existing columns
            # note: 'group' must be quoted in some contexts, but pragma usually takes string literal name
            result = conn.execute(text("PRAGMA table_info('group')"))
            columns = [row[1] for row in result.fetchall()]
            
            if 'image_url' not in columns:
                print("Adding image_url to Group table...")
                # Quoting "group" to avoid syntax error
                conn.execute(text('ALTER TABLE "group" ADD COLUMN image_url VARCHAR(255)'))
                conn.commit()
                print("Success: Column added.")
            else:
                print("image_url already exists.")
                
    except Exception as e:
        print(f"Migration Failed: {e}")
