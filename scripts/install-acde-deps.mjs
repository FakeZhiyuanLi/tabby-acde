#!/usr/bin/env node
// Installs the dependencies the acde port builds with: the root, app/, web/ and the plugins in
// acde-plugins.mjs, each from its own yarn.lock with install scripts off (no native builds, no
// patch-package), then links the plugins into node_modules as install-deps.mjs does.
// Uses only Node.js built-ins, since nothing is installed yet. Needs network access and Yarn 1
// (yarn on PATH, or npx to fetch yarn@1.22.22).
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { acdePlugins } from './acde-plugins.mjs'

const YARN_VERSION = '1.22.22'
const hasYarn = (() => {
    try {
        execSync('yarn --version', { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()
const yarn = hasYarn ? 'yarn' : `npx --yes yarn@${YARN_VERSION}`
const installCommand = `${yarn} install --ignore-scripts --frozen-lockfile --non-interactive --network-timeout 1000000`

for (const dir of ['.', 'app', 'web', ...acdePlugins]) {
    if (!existsSync(join(dir, 'yarn.lock'))) {
        console.log(`deps: ${dir} has no yarn.lock, skipped`)
        continue
    }
    console.log(`deps: ${dir}`)
    execSync(installCommand, { cwd: dir, stdio: 'inherit' })
}

mkdirSync('node_modules', { recursive: true })
for (const plugin of acdePlugins) {
    const link = join('node_modules', plugin)
    rmSync(link, { force: true, recursive: false })
    symlinkSync(join('..', plugin), link)
}
console.log('deps: done; next: node scripts/build-acde.mjs')
