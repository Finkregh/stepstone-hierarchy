import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/pi-extension.ts'],
  sourcemap: true,
  target: 'node24',
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
})
