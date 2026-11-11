// node scripts/verify/scout-v3/build.cjs -> .screenshots/scout-v3/harness/harness.js (webpack's Node API; no CLI needed).
const webpack = require('webpack');
webpack(require('./webpack.config.cjs'), (err, stats) => {
  if (err) { console.error(err); process.exit(1); }
  const info = stats.toJson({ all: false, errors: true, warnings: false, assets: true });
  if (stats.hasErrors()) { console.error(info.errors.slice(0, 5).map(e => e.message.slice(0, 600)).join('\n---\n')); process.exit(1); }
  console.log('built', info.assets.map(a => `${a.name} ${Math.round(a.size / 1024)} KB`).join(', '));
});
