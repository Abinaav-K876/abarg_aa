import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'supersecret123')
    uri = os.environ.get('DATABASE_URL', 'sqlite:///abarg_a.db')
    if uri and uri.startswith("postgres://"):
        uri = uri.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URI = uri
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Optimized for Render PostgreSQL stability
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
    }

    # Mail & Supabase Storage
    MAIL_SERVER = 'smtp.gmail.com'
    MAIL_PORT = 587
    MAIL_USE_TLS = True
    MAIL_USERNAME = os.environ.get('EMAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('EMAIL_APP_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('EMAIL_USERNAME')

    SUPABASE_URL = os.environ.get('SUPABASE_URL')
    if SUPABASE_URL and not SUPABASE_URL.endswith('/'):
        SUPABASE_URL += '/'
    SUPABASE_KEY = os.environ.get('SUPABASE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')