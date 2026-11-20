// node scripts/verify/actions-v2/build.cjs -> .screenshots/actions-v2/harness/{harness.js,index.html}
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const config = require('./webpack.config.cjs');
webpack(config, (err, stats) => {
  if (err) { console.error(err); process.exit(1); }
  const info = stats.toJson({ all: false, errors: true, warnings: false, assets: true });
  if (stats.hasErrors()) { console.error(info.errors.slice(0, 5).map(e => e.message.slice(0, 600)).join('\n---\n')); process.exit(1); }
  fs.writeFileSync(path.join(config.output.path, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Today harness</title></head><body><div id="root"></div><script src="harness.js"></script></body></html>');
  console.log('built', info.assets.map(a => `${a.name} ${Math.round(a.size / 1024)} KB`).join(', '));
});
