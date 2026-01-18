
const API_BASE = window.location.origin;

export const api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    delete: (url) => request('DELETE', url),
    upload: (url, file, fieldName = 'image') => upload(url, file, fieldName),
    setToken: (token) => localStorage.setItem('token', token),
    getToken: () => localStorage.getItem('token'),
    logout: () => {
        localStorage.removeItem('token');
        window.location.reload();
    }
};

async function request(method, url, body = null) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
        const res = await fetch(API_BASE + url, options);
        const data = await res.json();
        
        if (!res.ok) {
            if (res.status === 401 || res.status === 422) {
                // Token invalid
                if (!url.includes('/login')) {
                    localStorage.removeItem('token');
                    // Optional: Dispatch event to redirect to login
                    window.dispatchEvent(new CustomEvent('auth-error'));
                }
            }
            throw new Error(data.msg || 'Request failed');
        }
        return data;
    } catch (e) {
        console.error("API Error:", e);
        throw e;
    }
}

async function upload(url, file, fieldName) {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append(fieldName, file);

    const res = await fetch(API_BASE + url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || 'Upload failed');
    return data;
}
