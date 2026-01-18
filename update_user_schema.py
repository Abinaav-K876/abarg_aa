from app import app, db
from sqlalchemy import text, inspect

with app.app_context():
    try:
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('user')]
        
        if 'description' not in columns:
            print("Adding description to User table...")
            with db.engine.connect() as conn:
                conn.execute(text('ALTER TABLE user ADD COLUMN description VARCHAR(255)'))
                conn.commit()
            print("Success.")
        else:
            print("description exists.")
    except Exception as e:
        print(f"Error: {e}")
