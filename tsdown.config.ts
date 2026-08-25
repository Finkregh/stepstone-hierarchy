import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  sourcemap: true,
  target: 'node',
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
})
