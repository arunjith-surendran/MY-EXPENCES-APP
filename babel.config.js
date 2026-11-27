module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Values from .env, imported as `import { API_URL } from '@env'`.
    ['module:react-native-dotenv', { moduleName: '@env', path: '.env', safe: false, allowUndefined: true }],
    // Must stay last: compiles Reanimated worklets.
    'react-native-worklets/plugin',
  ],
};
