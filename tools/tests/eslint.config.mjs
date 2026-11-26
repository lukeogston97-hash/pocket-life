// Lint for the server and the game (both ES modules: a name used but not imported is an error, and so is changing an import).
import globals from 'globals';
const rules = { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-undef': 'error', 'no-unreachable': 'warn', 'no-dupe-keys': 'error',
  'no-redeclare': 'error', 'no-self-assign': 'warn', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-fallthrough': 'warn', 'no-import-assign': 'error' };
export default [
  { files: ['build/lint-server/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.worker, WebSocketPair: 'readonly' } }, rules },
  { files: ['build/lint-game/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } }, rules },
];
