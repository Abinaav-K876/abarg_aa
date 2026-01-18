import { api } from './api.js';

export default function chatApp() {
    return {
        // --- State ---
        user: null,
        token: api.getToken(),
        view: 'loading', // loading, auth, app, settings, create_group
        authMode: 'login',
        currentTheme: localStorage.getItem('theme') || 'theme-light',
        
        // Data
        chats: [],
        allUsers: [],
        searchQuery: '',
        
        // Active Chat & View
        activeChat: null,
        messages: [],
        messageInput: '',
        viewingUser: null, 
        
        // UI State
        showSidebar: true,
        showAttach: false,
        chatMenu: false,
        replyingTo: null,
        typingUser: false, 
        typingTimeout: null,
        chatSearch: false,
        chatSearchQuery: '',
        
        modals: {
            contacts: false,
            groupMembers: false,
            viewProfile: false,
            addMember: false
        },
        
        // Forms
        loginForm: { email: '', password: '' },
        regForm: { username: '', email: '', password: '' },
        groupForm: { name: '', selectedFriends: [] },
        
        // Socket
        socket: null,

        // --- Init ---
        async init() {
            // Apply theme immediately
            this.setTheme(this.currentTheme);

            if (this.token) {
                try {
                    this.user = await api.get('/profile');
                    this.view = 'app';
                    this.connectSocket();
                    this.refreshData();
                    this.loadAllUsers(); 
                } catch (e) {
                    this.logout();
                }
            } else {
                this.view = 'auth';
            }
            window.addEventListener('auth-error', () => this.logout());
        },
        
        // --- Theme Logic ---
        setTheme(themeName) {
            this.currentTheme = themeName;
            localStorage.setItem('theme', themeName);
        },

        // --- Auth ---
        async login() {
            try {
                const data = await api.post('/login', this.loginForm);
                api.setToken(data.access_token);
                this.token = data.access_token;
                window.location.reload();
            } catch (e) { alert(e.message); }
        },

        async register() {
            try {
                await api.post('/register', this.regForm);
                alert('REGISTRATION_COMPLETE. PLEASE_LOGIN.');
                this.authMode = 'login';
            } catch (e) { alert(e.message); }
        },

        logout() {
            if (this.socket) this.socket.disconnect();
            api.logout();
        },

        // --- Data ---
        async refreshData() {
            const [conversations, groups] = await Promise.all([
                api.get('/conversations'),
                api.get('/groups')
            ]);
            
            const privateChats = conversations.map(c => ({
                id: c.user_id,
                name: c.username,
                image: c.profile_image,
                type: 'private',
                conversation_id: c.conversation_id, 
                online: c.is_online,
                last_seen: c.last_seen,
                last_msg: c.last_msg,
                last_msg_time: c.last_msg_time ? this.formatTime(c.last_msg_time) : '',
                unread: c.unread
            }));
            
            const groupChats = groups.map(g => ({
                id: g.id,
                name: g.name,
                image: g.image_url,
                type: 'group',
                last_msg: 'GROUP_DATA',
                last_msg_time: '',
                unread: 0,
                member_count: g.member_count,
                created_by: g.created_by
            }));
            
            this.chats = [...privateChats, ...groupChats].sort((a,b) => {
                return (b.last_msg_time > a.last_msg_time) ? 1 : -1;
            });
        },
        
        async loadAllUsers() {
            try {
                this.allUsers = await api.get('/users');
            } catch(e) { console.error(e); }
        },
        
        get filteredUsers() {
            if (!this.searchQuery) return this.allUsers;
            const q = this.searchQuery.toLowerCase();
            return this.allUsers.filter(u => u.username.toLowerCase().includes(q));
        },
        
        get filteredMessages() {
            if (!this.chatSearch || !this.chatSearchQuery) return this.messages;
            const q = this.chatSearchQuery.toLowerCase();
            return this.messages.filter(m => 
                (m.content && m.content.toLowerCase().includes(q)) || 
                (m.sender_name && m.sender_name.toLowerCase().includes(q))
            );
        },
        
        getSortedChats() {
            return this.chats;
        },

        isActive(chat) {
            return this.activeChat && this.activeChat.id === chat.id && this.activeChat.type === chat.type;
        },

        // --- Chat Selection ---
        async startChatWith(user) {
            let chat = this.chats.find(c => c.type === 'private' && c.id === user.id);
            
            if (!chat) {
                chat = {
                    id: user.id,
                    name: user.username,
                    image: user.profile_image,
                    type: 'private',
                    online: user.is_online,
                    last_seen: user.last_seen,
                    last_msg: 'NEW_LINK',
                    unread: 0
                };
                this.chats.unshift(chat); 
            }
            this.modals.contacts = false;
            this.modals.viewProfile = false; 
            this.selectChat(chat);
        },

        async selectChat(chat) {
            this.activeChat = chat;
            this.messages = [];
            this.showSidebar = window.innerWidth >= 768;
            this.replyingTo = null;
            this.typingUser = false;
            this.messageInput = '';
            this.chatSearch = false; // Reset search

            if (chat.type === 'private') {
                try {
                    let chatId = chat.conversation_id;
                    if (!chatId) {
                        const res = await api.get(`/conversation-with/${chat.id}`);
                        chatId = res.conversation_id;
                        this.activeChat.conversation_id = chatId; 
                    }
                    
                    this.socket.emit('join_private_chat', { conversation_id: chatId });
                    await this.loadMessages(`/chat/history/${chatId}`);
                } catch(e) {
                    alert("LINK_FAILURE: " + e.message);
                }
            } else {
                this.socket.emit('join_group_chat', { group_id: chat.id });
                await this.loadMessages(`/group-chat/history/${chat.id}`);
                // Load role and members
                const members = await api.get(`/groups/${chat.id}/members`);
                this.activeChat.members = members;
                const me = members.find(m => m.id === this.user.id);
                this.activeChat.role = me ? me.role : 'member';
            }
        },

        async loadMessages(endpoint) {
            this.messages = await api.get(endpoint);
            this.scrollToBottom();
        },
        
        // --- User Profile & Group Members ---
        async viewUserProfile(userId) {
            try {
                this.viewingUser = await api.get(`/profile/${userId}`);
                this.modals.viewProfile = true;
            } catch (e) { alert(e.message); }
        },
        
        async addMemberToGroup(userId) {
            try {
                 await api.post(`/groups/${this.activeChat.id}/add-member`, { user_id: userId });
                 alert("NODE_ADDED.");
                 this.modals.addMember = false;
                 // Refresh members
                 const members = await api.get(`/groups/${this.activeChat.id}/members`);
                 this.activeChat.members = members;
            } catch(e) { alert(e.message); }
        },

        // --- Messaging ---
        handleTyping() {
            if (this.typingTimeout) clearTimeout(this.typingTimeout);
            
            const payload = this.activeChat.type === 'private' 
                ? { conversation_id: this.activeChat.conversation_id }
                : { group_id: this.activeChat.id };
            
            this.socket.emit('typing', payload);
            
            this.typingTimeout = setTimeout(() => {
                this.socket.emit('stop_typing', payload);
            }, 2000);
        },

        startReply(msg) {
            this.replyingTo = msg;
            document.querySelector('input[type="text"]')?.focus();
        },

        async sendMessage() {
            if (!this.messageInput.trim()) return;
            
            const tempId = 'temp_' + Date.now();
            const content = this.messageInput;
            
            this.messages.push({
                id: tempId,
                sender_id: this.user.id,
                sender_name: this.user.username,
                sender_dp: this.user.profile_image,
                content: content,
                timestamp: new Date().toISOString(),
                status: 'sending',
                reply_to: this.replyingTo ? {
                    sender_name: this.replyingTo.sender_name,
                    content: this.replyingTo.content
                } : null
            });
            this.scrollToBottom();
            
            const payload = {
                content: content,
                reply_to_id: this.replyingTo?.id,
                client_temp_id: tempId
            };
            
            this.sendPayload(payload);
            this.messageInput = '';
            this.replyingTo = null;
        },

        async uploadFile(e, type='image') {
            const file = e.target.files[0];
            if (!file) return;
            this.showAttach = false;

            try {
                const res = await api.upload('/upload-file', file, 'file');
                let msgType = res.type || 'file'; 
                if (type === 'audio') msgType = 'audio';

                const tempId = 'temp_' + Date.now();
                this.messages.push({
                    id: tempId,
                    sender_id: this.user.id,
                    sender_name: this.user.username,
                    sender_dp: this.user.profile_image,
                    file_url: res.url,
                    type: msgType,
                    timestamp: new Date().toISOString(),
                    status: 'sending'
                });
                this.scrollToBottom();

                this.sendPayload({
                    file_url: res.url,
                    type: msgType,
                    client_temp_id: tempId
                });
            } catch (err) {
                console.error(err);
                alert("UPLOAD_FAILED");
            }
        },

        sendPayload(data) {
            if (this.activeChat.type === 'private') {
                data.conversation_id = this.activeChat.conversation_id;
            } else {
                data.group_id = this.activeChat.id;
            }
            this.socket.emit('send_message', data);
        },
        
        async clearChat() {
            if(!confirm('CONFIRM_PURGE: DELETE ALL MESSAGES?')) return;
            try {
                const url = `/chat/clear/${this.activeChat.type}/${this.activeChat.type === 'group' ? this.activeChat.id : this.activeChat.conversation_id}`;
                await api.delete(url);
                this.messages = [];
                alert("LOGS_PURGED.");
            } catch (e) {
                alert("ERROR: " + e.message);
            }
        },

        async deleteChat() {
            if(!confirm('TERMINATE_LINK?')) return;
            const url = this.activeChat.type === 'group' ? 
                `/groups/${this.activeChat.id}/delete` : 
                `/chat/delete/${this.activeChat.conversation_id}`;
            await api.delete(url);
            this.activeChat = null;
            this.refreshData();
        },

        // --- Socket ---
        connectSocket() {
            this.socket = window.io(window.location.origin, { 
                query: { token: this.token },
                transports: ['websocket'] 
            });

            this.socket.on('new_message', (msg) => this.handleIncoming(msg));
            this.socket.on('new_group_message', (msg) => this.handleIncoming(msg));
            
            this.socket.on('typing', () => { this.typingUser = true; });
            this.socket.on('stop_typing', () => { this.typingUser = false; });
            
            this.socket.on('message_read', (data) => {
                const msg = this.messages.find(m => m.id === data.message_id);
                if (msg) msg.status = 'read';
            });

            this.socket.on('user_status', (data) => {
                const user = this.allUsers.find(u => u.id === data.user_id);
                if(user) {
                     user.is_online = (data.status === 'online');
                     if(data.last_seen) user.last_seen = data.last_seen;
                }
                const chat = this.chats.find(c => c.type === 'private' && c.id === data.user_id);
                if (chat) {
                    if (data.status === 'online') chat.online = true;
                    else {
                        chat.online = false;
                        chat.last_seen = data.last_seen;
                    }
                }
            });
        },

        handleIncoming(msg) {
            if (msg.client_temp_id) {
                const idx = this.messages.findIndex(m => m.id === msg.client_temp_id);
                if (idx !== -1) {
                    this.messages[idx] = msg;
                    return;
                }
            }

            let belongs = false;
            if (this.activeChat) {
                if (this.activeChat.type === 'private' && !msg.group_id && (msg.sender_id === this.activeChat.id || msg.sender_id === this.user.id)) belongs = true;
                if (this.activeChat.type === 'group' && msg.group_id === this.activeChat.id) belongs = true;
            }

            if (belongs) {
                if (!this.messages.find(m => m.id === msg.id)) {
                    this.messages.push(msg);
                    this.scrollToBottom();
                }
                if (msg.sender_id !== this.user.id) {
                     this.socket.emit('mark_read', { message_id: msg.id });
                }
            } else {
                const existing = this.chats.find(c => (c.type === 'private' && c.id === msg.sender_id) || (c.type === 'group' && c.id === msg.group_id));
                if (existing) {
                    existing.unread = (existing.unread || 0) + 1;
                    existing.last_msg = msg.content || 'MEDIA_DATA';
                    existing.last_msg_time = this.formatTime(msg.timestamp);
                } else {
                    this.refreshData(); 
                }
            }
        },

        scrollToBottom() {
            this.$nextTick(() => {
                const container = document.getElementById('messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            });
        },
        
        scrollToMsg(id) {
             // Logic to find element by ID and scroll
        },
        
        openChatInfo() {
             if(this.activeChat.type === 'group') this.modals.groupMembers = true;
             else this.viewUserProfile(this.activeChat.id);
        },

        // --- Utils ---
        avatar(url, name) {
            return url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=000&color=0F0&font-size=0.5`;
        },
        
        formatTime(iso) {
            if(!iso) return '';
            const d = new Date(iso);
            return d.toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit'});
        },
        
        // --- Group & Actions ---
        toggleFriendSelection(id) {
            if (this.groupForm.selectedFriends.includes(id)) {
                this.groupForm.selectedFriends = this.groupForm.selectedFriends.filter(x => x !== id);
            } else {
                this.groupForm.selectedFriends.push(id);
            }
        },

        async createGroup() {
            if (!this.groupForm.name) return;
            try {
                await api.post('/groups/create', {
                    group_name: this.groupForm.name,
                    member_ids: this.groupForm.selectedFriends
                });
                this.view = 'app';
                this.refreshData();
            } catch (e) { alert(e.message); }
        },
        
        viewMedia(url) {
            window.open(url, '_blank');
        },
        
    }
}