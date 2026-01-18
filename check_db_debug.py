from app import app, db
from sqlalchemy import text, inspect

with app.app_context():
    try:
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('group')]
        print(f"Group columns: {columns}")
        
        if 'image_url' not in columns:
            print("Attempting to add image_url...")
            with db.engine.connect() as conn:
                conn.execute(text('ALTER TABLE "group" ADD COLUMN image_url VARCHAR(255)'))
                conn.commit()
            print("Added image_url.")
        else:
            print("image_url exists.")
            
    except Exception as e:
        print(f"Error: {e}")
