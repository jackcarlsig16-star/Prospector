// Builds the actions-v2 visual harness (the real Today components, CRA's own Babel preset) into .screenshots/actions-v2/harness/.
const path = require('path');
const base = require('../scout-v3/webpack.config.cjs');
const ROOT = path.resolve(__dirname, '..', '..', '..');
module.exports = { ...base, entry: path.join(__dirname, 'harness.jsx'), output: { path: path.join(ROOT, '.screenshots', 'actions-v2', 'harness'), filename: 'harness.js' } };
