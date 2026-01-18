
import sqlite3
import os

# Adjust this if the DB path is different (e.g. inside instance folder)
DB_PATH = 'instance/ultimatum.db'

def migrate():
    # Check if DB exists
    db_file = os.path.join(os.getcwd(), DB_PATH)
    if not os.path.exists(db_file):
        print(f"Database not found at {db_file}. Skipping migration (tables will be created on app start).")
        return

    conn = sqlite3.connect(db_file)
    c = conn.cursor()

    try:
        # 1. Add column to Participant
        try:
            c.execute("ALTER TABLE participant ADD COLUMN custom_profile_image VARCHAR(255)")
            print("Added custom_profile_image to participant")
        except sqlite3.OperationalError:
            print("custom_profile_image already exists in participant")

        # 2. Add columns to GroupMember
        try:
            c.execute("ALTER TABLE group_member ADD COLUMN role VARCHAR(20) DEFAULT 'member'")
            print("Added role to group_member")
        except sqlite3.OperationalError:
            print("role already exists in group_member")

        try:
            c.execute("ALTER TABLE group_member ADD COLUMN custom_profile_image VARCHAR(255)")
            print("Added custom_profile_image to group_member")
        except sqlite3.OperationalError:
            print("custom_profile_image already exists in group_member")

        # 3. Add column to Message
        try:
            c.execute("ALTER TABLE message ADD COLUMN expires_at DATETIME")
            print("Added expires_at to message")
        except sqlite3.OperationalError:
            print("expires_at already exists in message")

        conn.commit()
        print("Migration complete.")
    except Exception as e:
        print(f"Migration failed: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
