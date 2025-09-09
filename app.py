from flask import Flask, render_template, request, redirect, url_for, flash, jsonify, session
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import pyotp
import sqlite3
import os
import logging
from datetime import datetime
from werkzeug.utils import secure_filename

# --- NEW: import our detector ---
from detectors.detect_image import detect_image_ai

app = Flask(__name__)
app.secret_key = os.urandom(24)  # Secure secret key for session management
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Ensure uploads directory exists
BASE_DIR = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# SQLite database setup
def init_db():
    with sqlite3.connect('users.db') as conn:
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            totp_secret TEXT
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            content TEXT,
            score INTEGER,
            confidence INTEGER,
            date TEXT,
            full_content TEXT,
            analysis TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )''')
        conn.commit()

init_db()

# User model for Flask-Login
class User(UserMixin):
    def __init__(self, id, username, totp_secret=None):
        self.id = id
        self.username = username
        self.totp_secret = totp_secret

# User loader for Flask-Login
@login_manager.user_loader
def load_user(user_id):
    with sqlite3.connect('users.db') as conn:
        c = conn.cursor()
        c.execute('SELECT id, username, totp_secret FROM users WHERE id = ?', (user_id,))
        user_data = c.fetchone()
        if user_data:
            return User(user_data[0], user_data[1], user_data[2])
        return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/text')
@login_required
def text():
    return render_template('text.html')

@app.route('/image')
@login_required
def image():
    return render_template('image.html')

@app.route('/video')
@login_required
def video():
    return render_template('video.html')

@app.route('/history')
@login_required
def history():
    try:
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            c.execute('SELECT id, type, content, score, confidence, date, full_content, analysis FROM history WHERE user_id = ?', (current_user.id,))
            analyses = [{
                'id': row[0],
                'type': row[1],
                'content': row[2],
                'score': row[3],
                'confidence': row[4],
                'date': row[5],
                'fullContent': row[6],
                'analysis': row[7]
            } for row in c.fetchall()]
        logging.debug(f"Rendering history with {len(analyses)} entries for user {current_user.id}")
        return render_template('history.html', analyses=analyses)
    except Exception as e:
        flash(f'Error loading history: {str(e)}', 'error')
        logging.error(f"History load error for user {current_user.id}: {str(e)}")
        return render_template('history.html', analyses=[])

@app.route('/profile')
@login_required
def profile():
    return render_template('profile.html')

@app.route('/settings')
@login_required
def settings():
    return render_template('settings.html')

@app.route('/results')
@login_required
def results():
    return render_template('result.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            c.execute('SELECT id, username, password, totp_secret FROM users WHERE username = ?', (username,))
            user_data = c.fetchone()
            if user_data and check_password_hash(user_data[2], password):
                user = User(user_data[0], user_data[1], user_data[3])
                login_user(user)
                if user.totp_secret:
                    session['pending_2fa'] = user.id
                    return redirect(url_for('two_factor'))
                return redirect(url_for('index'))
            flash('Invalid username or password', 'error')
        return redirect(url_for('login'))
    return render_template('login.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            try:
                hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
                totp_secret = pyotp.random_base32()
                c.execute('INSERT INTO users (username, password, totp_secret) VALUES (?, ?, ?)',
                          (username, hashed_password, totp_secret))
                conn.commit()
                flash('Account created successfully! Please sign in.', 'success')
                return redirect(url_for('login'))
            except sqlite3.IntegrityError:
                flash('Username already exists', 'error')
        return redirect(url_for('signup'))
    return render_template('signup.html')

@app.route('/two_factor', methods=['GET', 'POST'])
def two_factor():
    if not session.get('pending_2fa'):
        return redirect(url_for('login'))
    if request.method == 'POST':
        code = request.form['code']
        user_id = session['pending_2fa']
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            c.execute('SELECT totp_secret FROM users WHERE id = ?', (user_id,))
            row = c.fetchone()
            if not row:
                flash('User not found', 'error')
                return redirect(url_for('login'))
            totp_secret = row[0]
            totp = pyotp.TOTP(totp_secret)
            if totp.verify(code, valid_window=1):
                session.pop('pending_2fa', None)
                return redirect(url_for('index'))
            flash('Invalid 2FA code', 'error')
        return redirect(url_for('two_factor'))
    user_id = session['pending_2fa']
    with sqlite3.connect('users.db') as conn:
        c = conn.cursor()
        c.execute('SELECT totp_secret FROM users WHERE id = ?', (user_id,))
        row = c.fetchone()
        if not row:
            flash('User not found', 'error')
            return redirect(url_for('login'))
        totp_secret = row[0]
    username_for_uri = 'pending_user'
    totp_uri = pyotp.TOTP(totp_secret).provisioning_uri(name=username_for_uri, issuer_name='AI Content Detector')
    return render_template('two_factor.html', totp_uri=totp_uri)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out successfully', 'success')
    return redirect(url_for('login'))

@app.route('/api/history', methods=['GET', 'POST', 'DELETE'])
@login_required
def api_history():
    if request.method == 'POST':
        try:
            data = request.json
            required_fields = ['type', 'content', 'score', 'confidence', 'date', 'fullContent', 'analysis']
            if not all(field in data for field in required_fields):
                return jsonify({'status': 'error', 'message': 'Missing required fields'}), 400
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                c.execute('''INSERT INTO history (user_id, type, content, score, confidence, date, full_content, analysis)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                          (current_user.id, data['type'], data['content'], data['score'], data['confidence'],
                           data['date'], data['fullContent'], data['analysis']))
                conn.commit()
                c.execute('SELECT last_insert_rowid()')
                new_id = c.fetchone()[0]
            logging.debug(f"Added history entry {new_id} for user {current_user.id}")
            return jsonify({'status': 'success', 'message': 'History entry added', 'id': new_id})
        except Exception as e:
            logging.error(f"Error adding history for user {current_user.id}: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
    elif request.method == 'DELETE':
        try:
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                c.execute('DELETE FROM history WHERE user_id = ?', (current_user.id,))
                conn.commit()
            logging.debug(f"Cleared all history for user {current_user.id}")
            return jsonify({'status': 'success', 'message': 'All history cleared'})
        except Exception as e:
            logging.error(f"Error clearing history for user {current_user.id}: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
    else:
        try:
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                c.execute('SELECT id, type, content, score, confidence, date, full_content, analysis FROM history WHERE user_id = ?',
                          (current_user.id,))
                history = [{
                    'id': row[0], 'type': row[1], 'content': row[2], 'score': row[3], 'confidence': row[4],
                    'date': row[5], 'fullContent': row[6], 'analysis': row[7]
                } for row in c.fetchall()]
            logging.debug(f"Fetched {len(history)} history entries for user {current_user.id}")
            return jsonify(history)
        except Exception as e:
            logging.error(f"Error fetching history for user {current_user.id}: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/history/<int:entry_id>', methods=['GET', 'DELETE'])
@login_required
def history_entry(entry_id):
    if request.method == 'GET':
        try:
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                c.execute('SELECT id, type, content, score, confidence, date, full_content, analysis FROM history WHERE id = ? AND user_id = ?',
                          (entry_id, current_user.id))
                entry = c.fetchone()
                if entry:
                    result = {
                        'id': entry[0],
                        'type': entry[1],
                        'content': entry[2],
                        'score': entry[3],
                        'confidence': entry[4],
                        'date': entry[5],
                        'fullContent': entry[6],
                        'analysis': entry[7]
                    }
                    logging.debug(f"Fetched entry {entry_id} for user {current_user.id}")
                    return jsonify(result)
                else:
                    logging.warning(f"Entry {entry_id} not found or unauthorized for user {current_user.id}")
                    return jsonify({'status': 'error', 'message': 'Entry not found or unauthorized'}), 404
        except Exception as e:
            logging.error(f"Error fetching entry {entry_id} for user {current_user.id}: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
    elif request.method == 'DELETE':
        try:
            with sqlite3.connect('users.db') as conn:
                c = conn.cursor()
                c.execute('DELETE FROM history WHERE id = ? AND user_id = ?', (entry_id, current_user.id))
                conn.commit()
                if c.rowcount == 0:
                    logging.warning(f"Delete attempt failed for entry {entry_id} by user {current_user.id}: Not found or unauthorized")
                    return jsonify({'status': 'error', 'message': 'Entry not found or unauthorized'}), 404
                logging.debug(f"Deleted history entry {entry_id} for user {current_user.id}")
                return jsonify({'status': 'success', 'message': 'History entry deleted'})
        except Exception as e:
            logging.error(f"Error deleting entry {entry_id} for user {current_user.id}: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)}), 500

# --------------------------
# Image Detection API (fixed)
# --------------------------
@app.route('/api/detect/image', methods=['POST'])
@login_required
def api_detect_image():
    """
    Expects multipart/form-data with field name: 'image'
    Saves the file, runs detect_image_ai(save_path) -> (label, ai_percent),
    stores a row in 'history', and returns JSON.
    """
    file = request.files.get('image')
    if not file or not file.filename:
        return jsonify({'status': 'error', 'message': 'No image uploaded'}), 400

    # Save uploaded file
    try:
        filename = secure_filename(file.filename)
        save_path = os.path.join(UPLOAD_DIR, filename)
        file.save(save_path)
    except Exception as e:
        app.logger.exception("Failed to save uploaded file")
        return jsonify({'status': 'error', 'message': f'Failed to save file: {str(e)}'}), 500

    # Run detector (expects: (label: str, ai_percent: int or float 0-100))
    try:
        label, ai_percent = detect_image_ai(save_path)
        score = int(round(float(ai_percent)))   # 0–100
        confidence = score                      # placeholder: same as score
    except Exception as e:
        app.logger.exception("Image detection failed")
        return jsonify({'status': 'error', 'message': f'Detection failed: {str(e)}'}), 500

    # Build record for DB
    date_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    short_content = filename
    full_content = f"static/uploads/{filename}"

    # Save to history
    try:
        with sqlite3.connect('users.db') as conn:
            c = conn.cursor()
            c.execute(
                '''INSERT INTO history (user_id, type, content, score, confidence, date, full_content, analysis)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                (current_user.id, 'image', short_content, score, confidence, date_str, full_content, label)
            )
            conn.commit()
            c.execute('SELECT last_insert_rowid()')
            new_id = c.fetchone()[0]
    except Exception as e:
        app.logger.exception("Failed to save history")
        return jsonify({'status': 'error', 'message': f'Failed to save history: {str(e)}'}), 500

    # Success
    return jsonify({
        'status': 'success',
        'id': new_id,
        'type': 'image',
        'filename': filename,
        'path': full_content,
        'score': score,
        'confidence': confidence,
        'analysis': label,   # e.g., "AI Generated" or "Human"
        'date': date_str
    }), 200

if __name__ == '__main__':
    app.run(debug=True)
