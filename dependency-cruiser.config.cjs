module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true, pathNot: '^(server-only|client-only)$' } },
    { name: 'framework-markers-web-only', severity: 'error', from: { pathNot: '^apps/web/' }, to: { path: '^(server-only|client-only)$' } },
    { name: 'no-runtime-imports-of-tests', severity: 'error',
      from: { pathNot: '(^|/)(tests|__tests__)/|\\.(test|spec)\\.|(^|/)test_' },
      to: { path: '(^|/)(tests|__tests__)/|\\.(test|spec)\\.|(^|/)test_', preCompilationOnly: false } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|\\.next|data|test-results|tools/static-analysis)/|\\.d\\.ts$' },
    tsConfig: { fileName: require('node:path').resolve(__dirname, 'apps/web/tsconfig.json') },
    tsPreCompilationDeps: 'specify',
    enhancedResolveOptions: {
      extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json'],
      conditionNames: ['import', 'require', 'node', 'default'], exportsFields: ['exports'],
    },
  },
};
