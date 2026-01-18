import os
import shutil
from app import app, db

def init_database():
    print("🚀 Initializing Database with new schema...")
    
    # 1. Path to the database file
    # Get the URI and extract the path for SQLite
    uri = app.config['SQLALCHEMY_DATABASE_URI']
    if uri.startswith('sqlite:///'):
        db_path = uri.replace('sqlite:///', '')
        # Handle relative path (relative to the app root, but instance/ usually makes it relative)
        if not os.path.isabs(db_path):
             # Flask usually puts it in the instance folder if defined that way
             # But we'll try to find it relative to current working dir
             pass

    print(f"Target DB: {uri}")

    with app.app_context():
        try:
            # Drop all tables
            print("Dropping existing tables...")
            db.drop_all()
            
            # Create all tables
            print("Creating new tables based on updated models...")
            db.create_all()
            
            print("✅ Database tables generated successfully!")
            print("New fields included:")
            print(" - User: last_seen, is_online")
            print(" - Message: msg_type, status, file_url, reply_to_id")
            
        except Exception as e:
            print(f"❌ Error initializing database: {e}")

if __name__ == "__main__":
    init_database()
