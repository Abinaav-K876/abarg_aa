import sqlite3

def clean_duplicates():
    # Use absolute path to be sure
    db_path = r'c:\Users\NachammaiV\OneDrive\Desktop\Ultimatum\instance\chat.db'
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    
    print("Finding duplicates...")
    c.execute('''
        DELETE FROM reaction 
        WHERE id NOT IN (
            SELECT MAX(id) 
            FROM reaction 
            GROUP BY message_id, user_id
        )
    ''')
    
    deleted = c.rowcount
    print(f"Deleted {deleted} duplicate reactions.")
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    clean_duplicates()
