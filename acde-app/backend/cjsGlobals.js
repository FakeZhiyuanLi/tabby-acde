// acde bundles the backend into one ES module, but ssh2 is CommonJS and reads __dirname and
// __filename (for a Windows-only helper path and its bundled wasm loader). ES modules have
// neither, so define them before ssh2 loads. Import this module first.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

globalThis.__filename ??= fileURLToPath(import.meta.url)
globalThis.__dirname ??= dirname(globalThis.__filename)
