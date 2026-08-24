import * as esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.cjs',
  external: ['express', '@libsql/client', 'fsevents', 'vite'],
  format: 'cjs',
}).catch(() => process.exit(1));
