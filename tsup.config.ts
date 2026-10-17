import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/api/index.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: { entry: { index: 'src/api/index.ts' } },
  sourcemap: true,
  clean: true,
  splitting: true,
  shims: false,
});
