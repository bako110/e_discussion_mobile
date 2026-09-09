module.exports = {
  root: true,
  extends: '@react-native',
  // scripts/ = outils de build Node (ESM récent), pas du code app RN
  ignorePatterns: ['scripts/**', 'node_modules/**', 'android/**', 'ios/**'],
  rules: {
    'react-native/no-inline-styles': 'off',
    curly: ['warn', 'multi-line'],
    'no-void': 'off',
  },
  overrides: [
    {
      // Bit ops volontaires : primitives crypto + génération d'UUID v4 + hash
      files: [
        'src/crypto/**/*.ts',
        'src/polyfills/**/*.js',
        'src/components/common/Avatar.tsx',
        'src/components/story/storyConfig.ts',
        'src/sync/outbox.ts',
        'src/utils/random.ts',
      ],
      rules: { 'no-bitwise': 'off' },
    },
    {
      // Petits sous-composants (renderItem, tabBarIcon…) définis localement
      // pour rester près de leur usage — données passées en props, pas de state.
      files: ['src/screens/**/*.tsx', 'src/navigation/**/*.tsx', 'src/components/**/*.tsx'],
      rules: { 'react/no-unstable-nested-components': ['warn', { allowAsProps: true }] },
    },
  ],
};
