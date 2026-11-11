// Builds the scout-v3 visual harness (the real components, CRA's own Babel preset) into .screenshots/scout-v3/harness/.
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.BABEL_ENV = process.env.BABEL_ENV || 'development';
module.exports = {
  mode: 'development', devtool: false, context: ROOT,
  entry: path.join(__dirname, 'harness.jsx'),
  output: { path: path.join(ROOT, '.screenshots', 'scout-v3', 'harness'), filename: 'harness.js' },
  resolve: { extensions: ['.js', '.jsx'] },
  module: { rules: [
    { test: /\.(js|jsx)$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { babelrc: false, configFile: false, presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]] } } },
    { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] },
    { test: /\.(svg|png|jpg|gif|woff2?)$/, type: 'asset/inline' },
  ] },
  performance: { hints: false },
};
