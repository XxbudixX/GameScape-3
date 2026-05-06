// chat.js

// Whether a WebSocket connection is currently open.
let chatSocket = null;

// The username of the logged-in user. Set either from the Flask session check or from the username input.
let currentUsername = null;

// The username of whoever is currently open in the conversation panel on the right.
let currentChatPartner = null;

// A set of usernames that are currently connected via WebSocket. Used to show online status in the contacts list.
let onlineUsers = new Set();

// In-memory message store. Keyed by partner username. Lets us switch between conversations
// without re-fetching from the database every time.
let messagesHistory = {};

// Contacts loaded from the database (people the logged-in user has messaged before).
let dbContacts = [];

// Tracks whether the user is logged in via Flask session, used to decide what the UI shows.
let isLoggedIn = false;

const connectionStatusSpan = document.getElementById('connectionStatus');
const usernameInput         = document.getElementById('usernameInput');
const connectBtn            = document.getElementById('connectBtn');
const contactsListDiv       = document.getElementById('contactsList');
const messagesContainer     = document.getElementById('messagesContainer');
const messageInput          = document.getElementById('messageInput');
const sendBtn               = document.getElementById('sendBtn');
const currentChatNameSpan   = document.getElementById('currentChatName');


// Returns the current time formatted as HH:MM, used to timestamp messages displayed in the UI.
// No input. Returns a string.
function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// Escapes HTML special characters in a string to prevent XSS.
// Any user-supplied text (usernames, message content) should go through this before being put in innerHTML.
// Input: str (string). Returns a safe string.
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}


// Checks if the user has an active Flask session when the chat page loads.
// If they do, it pre-fills their username, marks the input as read-only, and loads their chat history from the DB.
// This means logged-in users don't need to manually connect — they land on the page already ready to chat.
// No input. Updates global state as a side effect.
async function checkLoginState() {
    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.logged_in) {
            isLoggedIn = true;
            currentUsername = data.username;

            usernameInput.value = data.username;
            usernameInput.readOnly = true;
            usernameInput.style.opacity = '0.6';
            usernameInput.style.cursor = 'not-allowed';

            connectionStatusSpan.textContent = `Logged in as ${data.username}`;
            connectionStatusSpan.className = 'status-online';

            await loadContactsFromDB();
        }
    } catch (e) {
        console.warn('Session check failed:', e);
    }
}


// Fetches the list of users the logged-in user has previously messaged, along with the last message snippet.
// Stores the result in dbContacts and re-renders the contacts panel.
// No input. Updates dbContacts and triggers renderContacts.
async function loadContactsFromDB() {
    try {
        const res = await fetch('/api/chat/contacts', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) {
            dbContacts = data.contacts;
            renderContacts();
        }
    } catch (e) {
        console.warn('Failed to load contacts:', e);
    }
}


// Loads the full message history between the current user and a specific partner from the database.
// Overwrites whatever was in memory for that partner so we always have an accurate view.
// Input: partnerUsername (string). Updates messagesHistory[partnerUsername] as a side effect.
async function loadChatHistory(partnerUsername) {
    try {
        const res = await fetch(`/api/chat/history/${encodeURIComponent(partnerUsername)}`, {
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (data.success) {
            messagesHistory[partnerUsername] = data.messages.map(m => ({
                from: m.from,
                to:   m.from === currentUsername ? partnerUsername : currentUsername,
                text: m.text,
                time: m.time
            }));
        }
    } catch (e) {
        console.warn('Failed to load chat history:', e);
    }
}


// Saves a sent message to the database via the Flask API.
// This is called every time a message is sent, regardless of whether WebSocket is active.
// Saving to the database ensures the message persists across sessions and page reloads.
// Input: toUsername (string), text (string). No return value.
async function saveMessageToDB(toUsername, text) {
    try {
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ to: toUsername, message: text })
        });
    } catch (e) {
        console.warn('Failed to save message to DB:', e);
    }
}


// Renders all messages for the given conversation partner into the messages panel.
// Clears any previous content first. Messages from the current user are right-aligned (class: self).
// After rendering, scrolls to the bottom so the newest message is visible.
// Input: partner (string) — the username whose conversation to display.
function renderMessages(partner) {
    messagesContainer.innerHTML = '';
    const history = messagesHistory[partner] || [];
    if (history.length === 0) {
        messagesContainer.innerHTML = '<div class="placeholder-message">No messages yet — say hi!</div>';
        return;
    }
    history.forEach(msg => {
        const isSelf = msg.from === currentUsername || msg.from === 'You';
        const sender = isSelf ? 'You' : msg.from;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSelf ? 'self' : ''}`;
        messageDiv.innerHTML = `
            <div class="sender">${escapeHtml(sender)}</div>
            <div class="text">${escapeHtml(msg.text)}</div>
            <div class="time">${msg.time}</div>
        `;
        messagesContainer.appendChild(messageDiv);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// Adds a single new message to the in-memory history and, if that conversation is currently open,
// immediately re-renders the messages panel to show it.
// This keeps the UI feeling instant — the message appears right away without waiting for the DB.
// Input: from (string), to (string), text (string). No return value.
function addMessageLocally(from, to, text) {
    const partner = from === currentUsername ? to : from;
    if (!messagesHistory[partner]) messagesHistory[partner] = [];
    messagesHistory[partner].push({ from, to, text, time: getTime() });
    if (currentChatPartner === partner) {
        renderMessages(partner);
    }
}


// Builds the contacts list from two sources: DB contacts (people with message history)
// and online WebSocket users (people currently connected). These are merged and deduplicated
// so a person who is both in the DB and online only appears once, with their online status shown.
// If the user isn't logged in and has no WebSocket connection, a demo contact is shown
// so the page doesn't look completely empty.
// No input. Rebuilds the contacts panel DOM.
function renderContacts() {
    contactsListDiv.innerHTML = '';

    const allUsernames = new Set();
    const contactMap = {};

    dbContacts.forEach(c => {
        allUsernames.add(c.username);
        contactMap[c.username] = {
            lastMessage: c.last_message,
            lastTime: c.last_time,
            isOnline: false
        };
    });

    onlineUsers.forEach(u => {
        if (u === currentUsername) return;
        allUsernames.add(u);
        if (contactMap[u]) {
            contactMap[u].isOnline = true;
        } else {
            contactMap[u] = { lastMessage: '', lastTime: '', isOnline: true };
        }
    });

    const wsConnected = chatSocket && chatSocket.readyState === WebSocket.OPEN;
    if (!wsConnected && !isLoggedIn) {
        allUsernames.add('DemoGamer');
        if (!contactMap['DemoGamer']) {
            contactMap['DemoGamer'] = { lastMessage: 'Hey! Want to play?', lastTime: '', isOnline: false };
        }
    }

    if (allUsernames.size === 0) {
        contactsListDiv.innerHTML = '<div class="contact-placeholder">No chats yet</div>';
        return;
    }

    [...allUsernames].forEach(username => {
        const info = contactMap[username] || {};
        const isDemo = username === 'DemoGamer';
        const isActive = currentChatPartner === username;

        let statusLabel;
        if (isDemo)             statusLabel = '● Demo mode';
        else if (info.isOnline) statusLabel = '● Online';
        else if (info.lastTime) statusLabel = `Last message ${info.lastTime}`;
        else                    statusLabel = '● Offline';

        const contactDiv = document.createElement('div');
        contactDiv.className = `contact-item ${isActive ? 'active' : ''}`;
        contactDiv.innerHTML = `
            <div class="contact-avatar">${username.charAt(0).toUpperCase()}</div>
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(username)}</div>
                <div class="contact-status">${statusLabel}</div>
            </div>
        `;
        contactDiv.addEventListener('click', () => {
            document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
            contactDiv.classList.add('active');

            if (isDemo) {
                loadDemoChat();
            } else {
                openChatWith(username);
            }
        });
        contactsListDiv.appendChild(contactDiv);
    });
}


// Opens a conversation with a real user. Fetches the full history from the database first,
// then renders it and enables the message input so the user can start typing.
// The loading state ("Loading messages...") gives feedback while the fetch is in progress.
// Input: username (string). No return value.
async function openChatWith(username) {
    currentChatPartner = username;
    currentChatNameSpan.textContent = username;
    messagesContainer.innerHTML = '<div class="placeholder-message">Loading messages...</div>';

    await loadChatHistory(username);
    renderMessages(username);

    messageInput.disabled = false;
    sendBtn.disabled = false;
}


// Loads a hardcoded fake conversation so the chat page has something to show visitors who aren't logged in.
// This gives them a feel for the UI without needing an account.
// No input. Sets currentChatPartner to 'DemoGamer' and renders the demo messages.
function loadDemoChat() {
    const demoContact = 'DemoGamer';
    if (!messagesHistory[demoContact]) {
        messagesHistory[demoContact] = [
            { from: demoContact, to: 'You', text: 'Hey! Want to play some Valorant?', time: '14:32' },
            { from: 'You', to: demoContact, text: 'Sure! What rank are you?', time: '14:33' },
            { from: demoContact, to: 'You', text: "Platinum 2, let's queue up!", time: '14:34' }
        ];
    }
    currentChatPartner = demoContact;
    currentChatNameSpan.textContent = demoContact;
    renderMessages(demoContact);
    messageInput.disabled = false;
    sendBtn.disabled = false;
}


// Opens a WebSocket connection to the Flask backend so messages can be received in real time.
// If a connection is already open, it's closed first to avoid duplicates.
// Incoming messages from other users are added to the in-memory history and rendered immediately.
// The contacts list is also updated whenever a new user sends a message (so they appear in the sidebar).
// Input: username (string) — the name to identify this connection with on the server.
function connectWebSocket(username) {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.close();
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    chatSocket = new WebSocket(`${protocol}//${window.location.host}/ws/${username}`);

    chatSocket.onopen = () => {
        currentUsername = username;
        connectionStatusSpan.textContent = `Connected as ${username}`;
        connectionStatusSpan.className = 'status-online';
        connectBtn.textContent = 'Disconnect';
        onlineUsers.clear();
        renderContacts();
        messagesContainer.innerHTML = '<div class="placeholder-message">Click on a friend to start chatting</div>';
    };

    chatSocket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.system) {
            // System messages from the server (e.g. "User X is not online") update the online set
            // but aren't shown in the chat window.
            if (data.system.includes('is not online')) {
                onlineUsers.delete(data.system.split(' ')[0]);
                renderContacts();
            }
            return;
        }
        addMessageLocally(data.from, currentUsername, data.message);
        if (!onlineUsers.has(data.from)) {
            onlineUsers.add(data.from);
            renderContacts();
        }
    };

    chatSocket.onclose = () => {
        connectionStatusSpan.textContent = isLoggedIn ? `Logged in as ${currentUsername}` : 'Disconnected';
        connectionStatusSpan.className = isLoggedIn ? 'status-online' : 'status-offline';
        connectBtn.textContent = 'Connect';
        onlineUsers.clear();
        renderContacts();
    };

    chatSocket.onerror = (err) => {
        console.error('WebSocket error', err);
        connectionStatusSpan.textContent = 'Connection error';
    };
}


// Handles sending a message. Covers three cases:
// 1. Demo mode (DemoGamer) — no DB or WebSocket, just fake it locally with a bot reply.
// 2. DB only — user is logged in but WebSocket isn't open. Saves to DB and shows locally.
// 3. Full mode — saves to DB and also sends over WebSocket so the recipient sees it in real time.
// No input. Reads from the message input field. No return value.
async function sendMessage() {
    if (currentChatPartner === 'DemoGamer') {
        const text = messageInput.value.trim();
        if (!text) return;
        addMessageLocally(currentUsername || 'You', 'DemoGamer', text);
        messageInput.value = '';
        setTimeout(() => {
            addMessageLocally('DemoGamer', currentUsername || 'You', 'Thanks for the demo! 😊');
        }, 1000);
        return;
    }

    if (!currentUsername) {
        alert('Please log in or connect first');
        return;
    }
    if (!currentChatPartner) {
        alert('Select a friend first');
        return;
    }

    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';

    await saveMessageToDB(currentChatPartner, text);
    addMessageLocally(currentUsername, currentChatPartner, text);

    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ to: currentChatPartner, message: text }));
    }
}


// Connect button toggles between connecting and disconnecting the WebSocket.
connectBtn.addEventListener('click', () => {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.close();
    } else {
        const username = usernameInput.value.trim();
        if (!username) {
            alert('Enter a username');
            return;
        }
        connectWebSocket(username);
    }
});

sendBtn.addEventListener('click', sendMessage);

// Allow sending with Enter key so the user doesn't have to click the button.
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !messageInput.disabled) {
        sendMessage();
    }
});

// Live search — filters the visible contact items as the user types.
// Doesn't touch the underlying data, just hides/shows DOM elements.
document.getElementById('searchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.contact-item').forEach(item => {
        const name = item.querySelector('.contact-name').textContent.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
});

// On page load: check the session first, then render the contacts list.
// The session check is awaited because renderContacts depends on dbContacts being populated.
document.addEventListener('DOMContentLoaded', async () => {
    await checkLoginState();
    renderContacts();
});
