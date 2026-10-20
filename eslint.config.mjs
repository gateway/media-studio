import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const js=require('@eslint/js');
const ts=require('typescript-eslint');
const sonar=require('eslint-plugin-sonarjs');
const hooks=require('eslint-plugin-react-hooks');
const globals=Object.fromEntries(['console','process','Buffer','URL','URLSearchParams','fetch','setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate','require','module','exports','__dirname','__filename','global','window','document','navigator','File','FormData','AbortController','AbortSignal','performance','TextDecoder','TextEncoder','Request','Response','Blob','Event','HTMLElement','HTMLInputElement','HTMLTextAreaElement','localStorage','sessionStorage','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','structuredClone','WebSocket'].map(k=>[k,'readonly']));
export default ts.config(
 {ignores:['**/node_modules/**','**/.next/**','**/*.d.ts','**/test-results/**','**/data/**','**/tools/static-analysis/**']},
 js.configs.recommended,
 ...ts.configs.recommended,
 {files:['**/*.{ts,tsx,js,mjs,cjs}'],languageOptions:{globals},plugins:{sonarjs:sonar},rules:{
  complexity:['warn',8], 'sonarjs/cognitive-complexity':['warn',12],
  'sonarjs/no-identical-functions':'warn','sonarjs/no-duplicated-branches':'warn',
  'sonarjs/no-all-duplicated-branches':'warn','sonarjs/no-identical-conditions':'error',
  '@typescript-eslint/no-explicit-any':'warn','@typescript-eslint/no-unused-vars':['warn',{args:'none',ignoreRestSiblings:true}],
  'array-callback-return':'error'
 }},
 {files:['apps/web/**/*.{ts,tsx}'],languageOptions:{parserOptions:{
   project:['./apps/web/tsconfig.lint.json'],tsconfigRootDir:fileURLToPath(new URL('.',import.meta.url))
 }},plugins:{'react-hooks':hooks},rules:{
   'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'error',
   '@typescript-eslint/no-floating-promises':['error',{ignoreVoid:false}],
   '@typescript-eslint/no-misused-promises':'error',
   '@typescript-eslint/switch-exhaustiveness-check':'error'
 }},
 {files:['scripts/check_assistant_layout.mjs'],languageOptions:{globals:{innerWidth:'readonly',innerHeight:'readonly'}}},
 {files:['**/*.{js,mjs,cjs}'],rules:{'@typescript-eslint/no-require-imports':'off'}}
);
