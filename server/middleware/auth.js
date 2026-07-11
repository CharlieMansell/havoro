const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-to-a-long-random-secret' || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is missing, is the example placeholder, or is under 32 characters');
  process.exit(1);
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };
