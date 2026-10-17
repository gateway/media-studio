export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'at-rule-no-unknown': [true, { ignoreAtRules: ['theme', 'source', 'utility', 'variant', 'custom-variant', 'apply', 'reference', 'config', 'plugin'] }],
    'at-rule-prelude-no-invalid': [true, { ignoreAtRules: ['theme', 'source', 'utility', 'variant', 'custom-variant', 'apply', 'reference', 'config', 'plugin'] }],
    'import-notation': 'string',
    // Tokens are deliberately defined in globals.css and admin.css. The existing
    // theme-drift guard owns raw-color policy; Stylelint still validates their CSS.
  },
};
