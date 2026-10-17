#!/usr/bin/env node

const { build, context } = require('esbuild')

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: watch,
  minify: !watch,
}

if (watch) {
  context(options).then((ctx) => ctx.watch())
} else {
  build(options).then(() => console.log('built dist/extension.js'))
}
