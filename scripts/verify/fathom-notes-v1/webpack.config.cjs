// Builds the fathom-notes-v1 visual harness (the real card, Today list and review panel) into .screenshots/fathom-notes-v1/harness/.
const path = require('path');
const base = require('../scout-v3/webpack.config.cjs');
const ROOT = path.resolve(__dirname, '..', '..', '..');
module.exports = { ...base, entry: path.join(__dirname, 'harness.jsx'), output: { path: path.join(ROOT, '.screenshots', 'fathom-notes-v1', 'harness'), filename: 'harness.js' } };
