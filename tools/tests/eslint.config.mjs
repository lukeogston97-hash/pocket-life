// Lint for the server (ES modules) and the game (its parts joined in order, as index.html does).
import globals from 'globals';
const rules = { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-undef': 'error', 'no-unreachable': 'warn', 'no-dupe-keys': 'error',
  'no-redeclare': 'error', 'no-self-assign': 'warn', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-fallthrough': 'warn' };
export default [
  { files: ['build/lint-server/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.worker, WebSocketPair: 'readonly' } }, rules },
  { files: ['build/game.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } }, rules },
];
