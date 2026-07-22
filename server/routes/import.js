const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { importCSV, previewCSV } = require('../services/csvImporter');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PROFILES_DIR = path.join(__dirname, '../bank-profiles');
const PROFILES_DIR_RESOLVED = path.resolve(PROFILES_DIR) + path.sep;

function loadProfile(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  const file = path.join(PROFILES_DIR, `${name}.json`);
  // Belt-and-suspenders on top of the regex above: confirms the resolved
  // path never leaves PROFILES_DIR before it's read.
  if (!path.resolve(file).startsWith(PROFILES_DIR_RESOLVED)) return null;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// GET /api/import/profiles — list available bank profiles
router.get('/profiles', (req, res) => {
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  const profiles = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
      return { id: f.replace('.json', ''), name: data.name, account_match: data.account_match };
    } catch { return null; }
  }).filter(Boolean);
  res.json(profiles);
});

// POST /api/import/preview — parse without saving, return sample rows
router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const profileId = req.body.profile;
  if (!profileId) return res.status(400).json({ error: 'profile required' });

  const profile = loadProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const result = previewCSV(req.file.buffer, profile);
  res.json(result);
});

// POST /api/import — import CSV into an account
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const { profile: profileId, account_id } = req.body;
  if (!profileId || !account_id) return res.status(400).json({ error: 'profile and account_id required' });

  const profile = loadProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  try {
    const result = importCSV(req.file.buffer, profile, Number(account_id));
    res.json(result);
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
