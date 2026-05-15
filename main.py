from flask import Flask, request, jsonify, session, send_from_directory
from databas import connect_db
from werkzeug.security import check_password_hash, generate_password_hash
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
app.secret_key = "hemlig_nyckel"


# Serves the main index.html page when someone visits the root URL.
# No input. Returns the index.html file from the project root.
@app.route('/')
def home():
    return send_from_directory(ROOT, 'index.html')


# Catches any URL that isn't a defined API route and tries to serve it as a static file.
# This is how the browser loads CSS, JS, and other HTML pages (login, register, chat, profile).
# Input: filename from the URL path. Returns the matching file from the project root, or 404 if it doesn't exist.
@app.route('/<path:filename>')
def serve_file(filename):
    return send_from_directory(ROOT, filename)


# Checks whether the current browser session has a logged-in user.
# The frontend calls this on page load to decide what UI to show (logged in vs guest).
# No input. Returns JSON with logged_in (bool), user_id, and username if a session exists.
@app.route('/api/me', methods=['GET'])
def me():
    if 'user_id' in session:
        return jsonify({
            'logged_in': True,
                'user_id': session['user_id'],
                'username': session['username'],
                'role' : session.get('role',False)
                })
    return jsonify({'logged_in': False , 'role':False})


# Handles user login. Accepts username or email so the user doesn't need to remember which one they signed up with.
# Looks up the user in the database, checks the hashed password, and creates a session on success.
# Input: JSON body with username_or_email and password.
# Returns JSON with success (bool) and username on success, or an error message on failure.
@app.route('/api/login', methods=['POST'])
def login():
    print('login rout hitt')
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data received'}), 400

    username_or_email = data.get('username_or_email', '').strip()
    password = data.get('password', '')

    if not username_or_email or not password:
        return jsonify({'success': False, 'error': 'Missing username or password'}), 400

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database connection error'}), 500

    try:
        cur.execute(
            'SELECT user_id, username, password , is_admin FROM users WHERE username = %s OR email = %s',
            (username_or_email, username_or_email)
        )
        user = cur.fetchone()

        if user is None:
            return jsonify({'success': False, 'error': 'User not found'}), 401
        if not check_password_hash(user[2], password):
            return jsonify({'success': False, 'error': 'Incorrect password'}), 401

        session['user_id'] = user[0]
        session['username'] = user[1]
        session['role'] = bool(user[3]) 
        return jsonify({'success': True, 'username': user[1]})

    except Exception as e:
        print(e)
        return jsonify({'success': False, 
                        'error': 'Login error'}), 500
    finally:
        cur.close()
        conn.close()

def is_admin():
    return session.get('role') == True

@app.route('/api/admin/add_game', methods=['POST'])
def add_game():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403

    data = request.get_json()
    name = data.get('name')
    image = data.get('image_name')

    conn, cur = connect_db()

    try:
        cur.execute(
            "INSERT INTO games (name, image_name) VALUES (%s, %s)",
            (name, image)
        )
        conn.commit()
        return jsonify({'success': True})

    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)})

    finally:
        cur.close()
        conn.close()

@app.route('/api/events', methods=['GET'])
def get_events():
    conn, cur = connect_db()
    cur.execute("SELECT id, title FROM events")
    rows = cur.fetchall()

    events = [{'id': r[0], 'title': r[1]} for r in rows]
    return jsonify({'events': events})


@app.route('/api/admin/delete_event/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    if not is_admin():
        return jsonify({'success': False}), 403

    conn, cur = connect_db()

    try:
        cur.execute("DELETE FROM events WHERE id = %s", (event_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        cur.close()
        conn.close()


# Handles new user registration. Validates all the rules (password length, uppercase, digit, etc.)
# before inserting into the database. Duplicate username and email are both checked separately
# so the error message can be specific about what's already taken.
# After successful registration, a session is created so the user is immediately logged in.
# Input: JSON body with username, password, confirm_password, full_name, email, birthday, gender.
# Returns JSON with success (bool) and username on success, or a specific error message on failure.
@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data received'}), 400

    username   = data.get('username', '').strip()
    password   = data.get('password', '')
    confirm_pw = data.get('confirm_password', '')
    full_name  = data.get('full_name', '').strip()
    email      = data.get('email', '').strip()
    birthday   = data.get('birthday', '')
    gender     = data.get('gender', '')

    if not username or not password or not email or not full_name:
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    if password != confirm_pw:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400
    if len(password) < 10:
        return jsonify({'success': False, 'error': 'Password must be at least 10 characters'}), 400
    if len(password) > 20:
        return jsonify({'success': False, 'error': 'Password must be at most 20 characters'}), 400
    if not any(c.isupper() for c in password):
        return jsonify({'success': False, 'error': 'Password must contain at least one uppercase letter'}), 400
    if not any(c.isdigit() for c in password):
        return jsonify({'success': False, 'error': 'Password must contain at least one digit'}), 400
    if not birthday:
        return jsonify({'success': False, 'error': 'Please select a birthday'}), 400
    if not gender:
        return jsonify({'success': False, 'error': 'Please select a gender'}), 400

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database connection error'}), 500

    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (username,))
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'Username already taken'}), 409

        cur.execute('SELECT user_id FROM users WHERE email = %s', (email,))
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'Email already registered'}), 409

        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        cur.execute(
            'INSERT INTO users (username, email, password, full_name, birthday, gender) VALUES (%s,%s,%s,%s,%s,%s) RETURNING user_id',
            (username, email, hashed_password, full_name, birthday, gender)
        )
        new_user_id = cur.fetchone()[0]
        conn.commit()

        session['user_id'] = new_user_id
        session['username'] = username
        return jsonify({'success': True, 'username': username})

    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': 'Registration error'}), 500
    finally:
        cur.close()
        conn.close()


# Clears the server-side session, effectively logging the user out.
# No input. Returns JSON with success: true.
@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


# Returns all players on the map who have a location set and are not set to invisible.
# The frontend uses this to place markers on the map.
# No input. Returns JSON with a list of player objects (id, gamertag, status, lat, lng, lastActive).
@app.route('/api/players', methods=['GET'])
def get_players():
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        cur.execute("""
            SELECT user_id, username, status, latitude, longitude, last_active
            FROM users
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status != 'invisible'
        """)
        rows = cur.fetchall()
        players = [
            {'id': r[0], 'gamertag': r[1], 'status': r[2] or 'offline',
             'lat': float(r[3]), 'lng': float(r[4]), 'lastActive': str(r[5]) if r[5] else 'Unknown'}
            for r in rows
        ]
        return jsonify({'success': True, 'players': players})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


# These two profile routes are commented out because the database columns (about_me, games, interests)
# haven't been added yet. Once the SQL migration runs, uncomment these and they'll work as-is.
#
# @app.route('/api/profile', methods=['GET'])
# def get_profile():
#     Fetches the logged-in user's profile data (about_me, games, interests).
#     No input. Returns JSON with those fields, empty strings if not set yet.
#     if 'user_id' not in session:
#         return jsonify({'success': False, 'error': 'Not logged in'}), 401
#     conn, cur = connect_db()
#     try:
#         cur.execute('SELECT username, about_me, games, interests FROM users WHERE user_id = %s', (session['user_id'],))
#         row = cur.fetchone()
#         return jsonify({'success': True, 'username': row[0], 'about_me': row[1] or '', 'games': row[2] or '', 'interests': row[3] or ''})
#     except Exception as e:
#         return jsonify({'success': False, 'error': str(e)}), 500
#     finally:
#         cur.close(); conn.close()
#
# @app.route('/api/profile', methods=['POST'])
# def save_profile():
#     Saves the logged-in user's updated profile data.
#     Input: JSON body with about_me, games, and interests (all strings).
#     Returns JSON with success: true on success, or an error message.
#     if 'user_id' not in session:
#         return jsonify({'success': False, 'error': 'Not logged in'}), 401
#     data = request.get_json()
#     conn, cur = connect_db()
#     try:
#         cur.execute('UPDATE users SET about_me=%s, games=%s, interests=%s WHERE user_id=%s',
#                     (data.get('about_me',''), data.get('games',''), data.get('interests',''), session['user_id']))
#         conn.commit()
#         return jsonify({'success': True})
#     except Exception as e:
#         conn.rollback()
#         return jsonify({'success': False, 'error': str(e)}), 500
#     finally:
#         cur.close(); conn.close()


# Returns a list of all users the logged-in user has ever exchanged messages with,
# along with the last message and its timestamp. Used to populate the chat contacts sidebar.
# The LATERAL JOIN is the key here — it efficiently grabs only the most recent message per contact
# without loading the entire message history.
# No input (reads user_id from session). Returns JSON with a list of contact objects.
@app.route('/api/chat/contacts', methods=['GET'])
def chat_contacts():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500

    try:
        query = """
            SELECT u.username, m.message, m.sent_at
            FROM users u
            JOIN LATERAL (
                SELECT message, sent_at
                FROM messages
                WHERE (sender_id = %s AND receiver_id = u.user_id)
                    OR (sender_id = u.user_id AND receiver_id = %s)
                ORDER BY sent_at DESC
                LIMIT 1
            ) m ON true
            WHERE u.user_id != %s
            ORDER BY m.sent_at DESC
        """
        cur.execute(query, (session['user_id'], session['user_id'], session['user_id']))
        rows = cur.fetchall()
        contacts = [
            {'username': row[0], 'last_message': row[1], 'last_time': row[2].strftime('%H:%M') if row[2] else ''}
            for row in rows
        ]
        return jsonify({'success': True, 'contacts': contacts})

    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


# Loads the full message history between the logged-in user and one specific other user.
# Messages are ordered oldest-first so they read chronologically in the chat window.
# Input: partner_username from the URL. Returns JSON with a list of message objects (from, text, time).
@app.route('/api/chat/history/<partner_username>', methods=['GET'])
def chat_history(partner_username):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500

    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (partner_username,))
        partner = cur.fetchone()
        if not partner:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        partner_id = partner[0]
        my_id = session['user_id']

        cur.execute("""
            SELECT u.username, m.message, m.sent_at
            FROM messages m
            JOIN users u ON u.user_id = m.sender_id
            WHERE (m.sender_id = %s AND m.receiver_id = %s)
               OR (m.sender_id = %s AND m.receiver_id = %s)
            ORDER BY m.sent_at ASC
        """, (my_id, partner_id, partner_id, my_id))
        rows = cur.fetchall()

        messages = [
            {'from': row[0], 'text': row[1], 'time': row[2].strftime('%H:%M') if row[2] else ''}
            for row in rows
        ]
        return jsonify({'success': True, 'messages': messages})

    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


# Saves a message from the logged-in user to another user in the database.
# This is called every time someone hits Send in the chat, even when WebSocket is also active.
# Storing in the database ensures message history persists across sessions and page reloads.
# Input: JSON body with to (recipient username) and message (text content).
# Returns JSON with success: true on success, or an error message.
@app.route('/api/chat/send', methods=['POST'])
def chat_send():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data'}), 400

    to_username  = data.get('to', '').strip()
    message_text = data.get('message', '').strip()

    if not to_username or not message_text:
        return jsonify({'success': False, 'error': 'Missing fields'}), 400

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500

    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (to_username,))
        receiver = cur.fetchone()
        if not receiver:
            return jsonify({'success': False, 'error': 'Recipient not found'}), 404

        cur.execute(
            'INSERT INTO messages (sender_id, receiver_id, message) VALUES (%s, %s, %s)',
            (session['user_id'], receiver[0], message_text)
        )
        conn.commit()
        return jsonify({'success': True})

    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    app.run(debug=True)
