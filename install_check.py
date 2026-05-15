import os, sys
from dotenv import load_dotenv

load_dotenv()
url = os.environ.get("DB_URL", "")
if not url:
    print("[ERROR] DB_URL is not set in .env")
    sys.exit(1)

try:
    import sqlalchemy
    engine = sqlalchemy.create_engine(url)
    with engine.connect() as c:
        c.execute(sqlalchemy.text("SELECT 1"))
    print("DB connection OK")
except Exception as e:
    print(f"[ERROR] DB connection failed: {e}")
    print("Check DB_URL in your .env file.")
    sys.exit(1)
