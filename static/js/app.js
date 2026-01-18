import { api } from './api.js';

export default function chatApp() {
    return {
        // --- State ---
        user: null,
        token: api.getToken(),
        view: 'loading', // loading, auth, app
        authMode: 'login',
        currentTheme: localStorage.getItem('theme') || 'theme-light',
        
        // Data
        chats: [],
        allUsers: [],
        searchQuery: '',
        
        // Active Chat
        activeChat: null,
        messages: [],
        messageInput: '',
        
        // Timers
        msgInterval: null,
        listInterval: null,

        // UI State
        showSidebar: true,
        showAttach: false,
        chatMenu: false,
        replyingTo: null,
        
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

        // --- Init ---
        async init() {
            this.setTheme(this.currentTheme);

            if (this.token) {
                try {
                    this.user = await api.get('/profile');
                    this.view = 'app';
                    this.startPolling();
                    this.loadAllUsers(); 
                } catch (e) {
                    this.logout();
                }
            } else {
                this.view = 'auth';
            }
        },
        
        setTheme(themeName) {
            this.currentTheme = themeName;
            localStorage.setItem('theme', themeName);
        },

        // --- Polling Logic ---
        startPolling() {
            // Initial Load
            this.refreshChatList();
            
            // Poll Chat List (Unread counts, Last Msg) every 5s
            this.listInterval = setInterval(() => this.refreshChatList(), 5000);
            
            // Poll Active Messages every 2s
            this.msgInterval = setInterval(() => {
                if(this.activeChat) {
                    this.refreshMessages(true); // true = silent refresh
                }
            }, 2000);
        },

        stopPolling() {
            if (this.listInterval) clearInterval(this.listInterval);
            if (this.msgInterval) clearInterval(this.msgInterval);
        },

        async refreshChatList() {
            try {
                const [conversations, groups] = await Promise.all([
                    api.get('/conversations'),
                    api.get('/groups')
                ]);
                
                // Map to unified format
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
                    unread: 0, // Server doesn't send unread for groups yet
                    member_count: g.member_count,
                    created_by: g.created_by
                }));
                
                // Merge and Sort
                this.chats = [...privateChats, ...groupChats].sort((a,b) => {
                    // Sort by time desc
                    const tA = a.last_msg_time || '';
                    const tB = b.last_msg_time || '';
                    return tA < tB ? 1 : -1;
                });

            } catch(e) { console.error("Poll Error:", e); }
        },

        async refreshMessages(silent = false) {
            if (!this.activeChat) return;
            const endpoint = this.activeChat.type === 'private' 
                ? `/chat/history/${this.activeChat.conversation_id}`
                : `/group-chat/history/${this.activeChat.id}`;
            
            try {
                const msgs = await api.get(endpoint);
                
                // Check if new messages arrived
                if (msgs.length > this.messages.length) {
                    this.messages = msgs;
                    if (!silent) this.scrollToBottom();
                    else {
                        // Only scroll if already near bottom? For now just auto-scroll
                        // or check if user is scrolling up
                        this.scrollToBottom();
                    }
                    
                    // Mark last msg as read if it's not ours
                    const last = msgs[msgs.length - 1];
                    if(last && last.sender_id !== this.user.id && last.status !== 'read') {
                        api.post('/chat/read', { message_id: last.id });
                    }
                }
            } catch(e) { console.error("Msg Poll Error:", e); }
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

        async logout() {
            this.stopPolling();
            try { await api.post('/logout', {}); } catch(e){}
            api.logout();
        },

        // --- Chat Selection ---
        async startChatWith(user) {
            // Check if exists
            let chat = this.chats.find(c => c.type === 'private' && c.id === user.id);
            if (!chat) {
                // Optimistic UI
                chat = {
                    id: user.id, name: user.username, image: user.profile_image,
                    type: 'private', online: user.is_online, last_seen: user.last_seen,
                    last_msg: '', unread: 0
                };
                this.chats.unshift(chat);
            }
            this.modals.contacts = false;
            this.selectChat(chat);
        },

        async selectChat(chat) {
            this.activeChat = chat;
            this.messages = [];
            this.showSidebar = window.innerWidth >= 768;
            this.replyingTo = null;

            if (chat.type === 'private') {
                if (!chat.conversation_id) {
                    const res = await api.get(`/conversation-with/${chat.id}`);
                    chat.conversation_id = res.conversation_id;
                }
                await this.refreshMessages();
            } else {
                await this.refreshMessages();
                // Load members logic if needed
                try {
                     const members = await api.get(`/groups/${chat.id}/members`);
                     this.activeChat.members = members;
                     const me = members.find(m => m.id === this.user.id);
                     this.activeChat.role = me ? me.role : 'member';
                } catch(e){}
            }
        },

        // --- Messaging ---
        startReply(msg) {
            this.replyingTo = msg;
            document.querySelector('input[type="text"]')?.focus();
        },

        async sendMessage() {
            if (!this.messageInput.trim()) return;
            
            const content = this.messageInput;
            const tempId = 'temp_' + Date.now();
            
            // Optimistic UI Update
            const optimisticMsg = {
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
            };
            this.messages.push(optimisticMsg);
            this.scrollToBottom();
            
            const payload = {
                content: content,
                reply_to_id: this.replyingTo?.id,
                conversation_id: this.activeChat.type === 'private' ? this.activeChat.conversation_id : null,
                group_id: this.activeChat.type === 'group' ? this.activeChat.id : null
            };

            try {
                const res = await api.post('/chat/send', payload);
                // Update ID and Status
                const idx = this.messages.findIndex(m => m.id === tempId);
                if (idx !== -1) {
                    this.messages[idx].id = res.id;
                    this.messages[idx].status = 'sent';
                }
            } catch (e) {
                alert("Failed to send: " + e.message);
                this.messages = this.messages.filter(m => m.id !== tempId);
            }

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
                
                const payload = {
                    file_url: res.url,
                    type: msgType,
                    conversation_id: this.activeChat.type === 'private' ? this.activeChat.conversation_id : null,
                    group_id: this.activeChat.type === 'group' ? this.activeChat.id : null
                };
                
                await api.post('/chat/send', payload);
                this.refreshMessages(true); // Immediate refresh
                
            } catch (err) {
                alert("UPLOAD_FAILED");
            }
        },

        // --- Helpers ---
        scrollToBottom() {
            this.$nextTick(() => {
                const container = document.getElementById('messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            });
        },
        
        formatTime(iso) {
            if(!iso) return '';
            const d = new Date(iso);
            return d.toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit'});
        },
        
        avatar(url, name) {
            return url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=000&color=0F0&font-size=0.5`;
        },
        
        // --- Other Data ---
        async loadAllUsers() {
            try { this.allUsers = await api.get('/users'); } catch(e){}
        },
        
        get filteredUsers() {
            if (!this.searchQuery) return this.allUsers;
            const q = this.searchQuery.toLowerCase();
            return this.allUsers.filter(u => u.username.toLowerCase().includes(q));
        },
        
        // --- Group Actions ---
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
                this.refreshChatList();
            } catch (e) { alert(e.message); }
        },
        
        viewMedia(url) { window.open(url, '_blank'); },
        
        openChatInfo() {
             if(this.activeChat.type === 'group') this.modals.groupMembers = true;
             else this.modals.viewProfile = true; 
        }
    }
}
