const express = require('express');
const mysql = require('mysql2/promise'); // Use the promise-based version
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// Create the database connection using async/await
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

let db;

async function connectDatabase() {
  try {
    db = await mysql.createConnection(dbConfig);
    console.log('Connected to database.');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1); // Exit the process if the connection fails
  }
}

// Initialize database connection
connectDatabase();

const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(403).json({ message: 'Access Denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Signup Route
app.post('/signup', async (req, res) => {
  const { firstName, lastName, username, email, password, confirmPassword } = req.body;

  if (!firstName || !lastName || !username || !email || !password || !confirmPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const [results] = await db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);

    if (results.length > 0) {
      return res.status(400).json({ message: 'User already exists with this username or email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO users (first_name, last_name, username, email, password) VALUES (?, ?, ?, ?, ?)',
      [firstName, lastName, username, email, hashedPassword]
    );

    res.status(201).json({ success: true, message: 'Signup successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [results] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

    if (results.length === 0) return res.status(400).json({ message: 'Invalid username or password' });

    const user = results[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const loginTime = new Date();

    await db.query('INSERT INTO user_log (user_id, login_time) VALUES (?, ?)', [user.id, loginTime]);

    res.status(200).json({ success: true, token, use_id: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const logoutTime = new Date();

  try {
    const [results] = await db.query(
      'SELECT * FROM user_log WHERE user_id = ? AND logout_time IS NULL ORDER BY login_time DESC LIMIT 1',
      [userId]
    );

    if (results.length === 0) return res.status(400).json({ message: 'No active session found' });

    const sessionDuration = Math.floor((logoutTime - new Date(results[0].login_time)) / 1000);

    await db.query(
      'UPDATE user_log SET logout_time = ?, session_duration = ? WHERE user_id = ? AND logout_time IS NULL',
      [logoutTime, sessionDuration, userId]
    );

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/getUsername', authenticateToken, async (req, res) => {
  try {
    const [results] = await db.query('SELECT username FROM users WHERE id = ?', [req.user.id]);
    if (results.length === 0) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ username: results[0].username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Profile Route
app.get('/getProfile', authenticateToken, async (req, res) => {
  try {
    const [results] = await db.query('SELECT username, email, first_name, last_name FROM users WHERE id = ?', [req.user.id]);
    if (results.length === 0) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/updateProfile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, username, email } = req.body;

    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
      [username, email, userId]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Username or email already in use' });
    }

    const [result] = await db.query(
      'UPDATE users SET first_name = ?, last_name = ?, username = ?, email = ? WHERE id = ?',
      [firstName, lastName, username, email, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found or no changes made' });
    }

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Define a route to get disease solutions
app.get('/getDiseaseSolutions', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM disease_solutions');
    res.json(results);
  } catch (err) {
    res.status(500).send('Error fetching disease solutions');
  }
});

// New route to get diseases
app.get('/getDiseases', async (req, res) => {
  try {
    const [results] = await db.query('SELECT DISTINCT disease FROM disease_products');
   // console.log(results);
    res.json(results);
  } catch (err) {
    res.status(500).send('Error fetching diseases');
  }
});

app.get('/getMedicine', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT id, product AS name, disease, purchase_link AS link
      FROM disease_products
    `);
    //console.log(rows);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching medicines:", error);
    res.status(500).send("Error fetching medicine data");
  }
});


const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
