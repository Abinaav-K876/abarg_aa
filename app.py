
import os
import uuid
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity, create_access_token
from flask_mail import Mail, Message as MailMessage
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename
from sqlalchemy import func
from supabase import create_client

# Local Imports
from config import Config
from models import db, User, EmailOTP, Conversation, Participant, Group, GroupMember, Message, Reaction, FriendRequest, Friend

# === App Initialization ===
app = Flask(__name__)
app.config.from_object(Config)

# Fix for proxy headers
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config['UPLOAD_FOLDER'] = 'uploads'

# Extensions
CORS(app, origins="*")
mail = Mail(app)
JWTManager(app)

# Database
db.init_app(app)
with app.app_context():
    db.create_all()

# Storage (Supabase)
supabase = create_client(app.config['SUPABASE_URL'], app.config['SUPABASE_KEY'])


# === Utilities ===
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'pdf', 'txt', 'doc', 'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def upload_file_helper(file):
    """Uploads file to Supabase or local storage fallback."""
    filename = secure_filename(file.filename)
    new_filename = f"{uuid.uuid4().hex}_{filename}"
    
    local_folder = app.config['UPLOAD_FOLDER']
    if not os.path.exists(local_folder):
        os.makedirs(local_folder)

    try:
        file_content = file.read()
        file.seek(0)
        
        supabase.storage.from_("uploads").upload(
            path=new_filename,
            file=file_content,
            file_options={"content-type": file.mimetype}
        )
        
        supa_url = app.config['SUPABASE_URL'].rstrip('/')
        return f"{supa_url}/storage/v1/object/public/uploads/{new_filename}"

    except Exception as e:
        print(f"⚠️ Supabase Upload Failed: {e}. Falling back to local.")
        file.seek(0)
        file.save(os.path.join(local_folder, new_filename))
        from flask import url_for
        return url_for('uploaded_file', filename=new_filename, _external=True)


# === HTTP Routes ===

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# -- Auth --
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if User.query.filter_by(email=data['email']).first():
            return jsonify({"msg": "Email taken"}), 400
        if User.query.filter_by(username=data['username']).first():
            return jsonify({"msg": "Username taken"}), 400

        user = User(username=data['username'], email=data['email'], is_verified=True)
        user.set_password(data['password'])
        db.session.add(user)
        db.session.commit()
        return jsonify({"msg": "Registered successfully"}), 201
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email')).first()
    if user and user.check_password(data.get('password')):
        token = create_access_token(identity=str(user.id))
        # Update online status on login
        user.is_online = True
        db.session.commit()
        return jsonify(access_token=token), 200
    return jsonify({"msg": "Invalid credentials"}), 401

@app.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    user_id = int(get_jwt_identity())
    user = db.session.get(User, user_id)
    if user:
        user.is_online = False
        user.last_seen = datetime.utcnow()
        db.session.commit()
    return jsonify({"msg": "Logged out"}), 200

@app.route('/profile', methods=['GET'])
@jwt_required()
def profile():
    user = db.session.get(User, int(get_jwt_identity()))
    # Keep alive: Update last seen/online whenever they fetch profile
    user.is_online = True 
    user.last_seen = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        "id": user.id, "username": user.username, "email": user.email, 
        "profile_image": user.profile_image, "description": user.description
    })

# -- Data Fetching --
@app.route('/conversations', methods=['GET'])
@jwt_required()
def get_conversations():
    user_id = int(get_jwt_identity())
    convs = db.session.query(Conversation).join(Participant).filter(Participant.user_id == user_id).all()
    
    results = []
    for c in convs:
        other = Participant.query.filter(Participant.conversation_id == c.id, Participant.user_id != user_id).first()
        if other:
            u = db.session.get(User, other.user_id)
            if u:
                last_msg = Message.query.filter_by(conversation_id=c.id).order_by(Message.timestamp.desc()).first()
                unread = Message.query.filter_by(conversation_id=c.id, status='sent').filter(Message.sender_id != user_id).count()
                results.append({
                    "conversation_id": c.id, "user_id": u.id, "username": u.username,
                    "profile_image": u.profile_image, "is_online": u.is_online, "last_seen": u.last_seen,
                    "last_msg": last_msg.content if last_msg else "No messages",
                    "last_msg_time": last_msg.timestamp.isoformat() if last_msg else None,
                    "unread": unread
                })
    return jsonify(sorted(results, key=lambda x: x['last_msg_time'] or '', reverse=True))

@app.route('/groups', methods=['GET'])
@jwt_required()
def get_groups():
    user_id = int(get_jwt_identity())
    groups = db.session.query(Group).join(GroupMember).filter(GroupMember.user_id == user_id).all()
    return jsonify([{
        "id": g.id, "name": g.name, "image_url": g.image_url,
        "member_count": len(g.members), "created_by": g.created_by
    } for g in groups])

@app.route('/users', methods=['GET'])
@jwt_required()
def get_users():
    users = User.query.filter(User.id != int(get_jwt_identity())).all()
    return jsonify([{"id": u.id, "username": u.username, "profile_image": u.profile_image} for u in users])

# -- Chat Actions --
@app.route('/conversation-with/<int:friend_id>', methods=['GET'])
@jwt_required()
def get_conversation_with(friend_id):
    user_id = int(get_jwt_identity())
    conv = db.session.query(Conversation).join(Participant).filter(
        Participant.user_id.in_([user_id, friend_id])
    ).group_by(Conversation.id).having(func.count(Participant.id) == 2).first()

    if not conv:
        conv = Conversation()
        db.session.add(conv)
        db.session.flush()
        db.session.add_all([Participant(conversation_id=conv.id, user_id=uid) for uid in [user_id, friend_id]])
        db.session.commit()
    return jsonify({"conversation_id": conv.id})

# === NEW: REST Send Message ===
@app.route('/chat/send', methods=['POST'])
@jwt_required()
def send_message():
    user_id = int(get_jwt_identity())
    data = request.get_json()
    
    content = data.get('content', '')
    file_url = data.get('file_url') or data.get('image_url')
    msg_type = data.get('type', 'text')
    reply_to_id = data.get('reply_to_id')
    conversation_id = data.get('conversation_id')
    group_id = data.get('group_id')
    
    if not content and not file_url:
        return jsonify({"msg": "Empty message"}), 400

    msg = Message(
        sender_id=user_id,
        content=content,
        file_url=file_url,
        msg_type=msg_type,
        reply_to_id=reply_to_id,
        status='sent',
        timestamp=datetime.utcnow()
    )
    
    if data.get('lifespan'):
        msg.expires_at = datetime.utcnow() + timedelta(seconds=int(data['lifespan']))

    if conversation_id:
        if not Participant.query.filter_by(conversation_id=conversation_id, user_id=user_id).first():
            return jsonify({"msg": "Unauthorized"}), 403
        msg.conversation_id = conversation_id
    elif group_id:
        if not GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first():
            return jsonify({"msg": "Unauthorized"}), 403
        msg.group_id = group_id
    else:
        return jsonify({"msg": "Target required"}), 400
        
    db.session.add(msg)
    db.session.commit()
    
    return jsonify({"msg": "Sent", "id": msg.id, "timestamp": msg.timestamp.isoformat()}), 201

# === NEW: Read Receipt Endpoint ===
@app.route('/chat/read', methods=['POST'])
@jwt_required()
def mark_read():
    user_id = int(get_jwt_identity())
    msg_id = request.json.get('message_id')
    msg = db.session.get(Message, msg_id)
    if msg and msg.sender_id != user_id:
        msg.status = 'read'
        db.session.commit()
    return jsonify({"msg": "Read"}), 200


@app.route('/chat/history/<int:conversation_id>', methods=['GET'])
@jwt_required()
def chat_history(conversation_id):
    user_id = int(get_jwt_identity())
    if not Participant.query.filter_by(conversation_id=conversation_id, user_id=user_id).first():
        return jsonify({"msg": "Unauthorized"}), 403
    
    messages = Message.query.filter(
        Message.conversation_id == conversation_id,
        (Message.expires_at == None) | (Message.expires_at > datetime.utcnow())
    ).order_by(Message.timestamp).all()
    
    return jsonify(_serialize_messages(messages, conversation_id=conversation_id))

@app.route('/group-chat/history/<int:group_id>', methods=['GET'])
@jwt_required()
def group_history(group_id):
    user_id = int(get_jwt_identity())
    if not GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first():
        return jsonify({"msg": "Unauthorized"}), 403
        
    messages = Message.query.filter(
        Message.group_id == group_id,
        (Message.expires_at == None) | (Message.expires_at > datetime.utcnow())
    ).order_by(Message.timestamp).all()
    
    return jsonify(_serialize_messages(messages, group_id=group_id))

def _serialize_messages(messages, conversation_id=None, group_id=None):
    # Optimised DP fetching
    user_dps = {}
    if conversation_id:
        parts = Participant.query.filter_by(conversation_id=conversation_id).all()
        for p in parts:
            u = db.session.get(User, p.user_id)
            user_dps[p.user_id] = p.custom_profile_image or u.profile_image
    elif group_id:
        mems = GroupMember.query.filter_by(group_id=group_id).all()
        for m in mems:
            u = db.session.get(User, m.user_id)
            user_dps[m.user_id] = m.custom_profile_image or u.profile_image

    result = []
    for m in messages:
        sender = db.session.get(User, m.sender_id)
        reaction_counts = {}
        for r in m.reactions: reaction_counts[r.emoji] = reaction_counts.get(r.emoji, 0) + 1
        
        reply_ctx = None
        if m.reply_to:
             rs = db.session.get(User, m.reply_to.sender_id)
             reply_ctx = {"id": m.reply_to.id, "sender_name": rs.username if rs else "?", "content": m.reply_to.content}

        result.append({
            "id": m.id,
            "sender_id": m.sender_id,
            "sender_name": sender.username if sender else "Unknown",
            "sender_dp": user_dps.get(m.sender_id),
            "content": m.content,
            "file_url": m.file_url,
            "type": m.msg_type,
            "status": m.status,
            "reply_to": reply_ctx,
            "timestamp": m.timestamp.isoformat(),
            "reactions": reaction_counts
        })
    return result

# -- Groups Management --
@app.route('/groups/create', methods=['POST'])
@jwt_required()
def create_group():
    user_id = int(get_jwt_identity())
    data = request.get_json()
    group = Group(name=data['group_name'], created_by=user_id)
    db.session.add(group)
    db.session.flush()
    
    db.session.add(GroupMember(group_id=group.id, user_id=user_id, role='admin'))
    for mid in data.get('member_ids', []):
        if mid != user_id: db.session.add(GroupMember(group_id=group.id, user_id=mid))
    
    db.session.commit()
    return jsonify({"msg": "Created", "group_id": group.id}), 201

@app.route('/groups/<int:group_id>/members', methods=['GET'])
@jwt_required()
def get_group_members(group_id):
    members = db.session.query(User, GroupMember).join(GroupMember).filter(GroupMember.group_id == group_id).all()
    return jsonify([{
        "id": u.id, "username": u.username, "role": gm.role,
        "profile_image": gm.custom_profile_image or u.profile_image
    } for u, gm in members])

@app.route('/groups/<int:group_id>/add-member', methods=['POST'])
@jwt_required()
def add_group_member(group_id):
    db.session.add(GroupMember(group_id=group_id, user_id=request.json['user_id']))
    db.session.commit()
    return jsonify({"msg": "Added"}), 200

# -- File Uploads --
@app.route('/upload-file', methods=['POST'])
@jwt_required()
def upload_endpoint():
    if 'file' not in request.files: return jsonify({"msg": "No file"}), 400
    return jsonify({"url": upload_file_helper(request.files['file']), "type": "file"}), 201

@app.route('/profile/upload-dp', methods=['POST'])
@jwt_required()
def upload_dp():
    url = upload_file_helper(request.files['image'])
    user = db.session.get(User, int(get_jwt_identity()))
    user.profile_image = url
    db.session.commit()
    return jsonify({"url": url}), 200

# === Run ===
if __name__ == "__main__":
    # Standard Flask run, no SocketIO
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5240)))
