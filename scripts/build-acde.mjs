#!/usr/bin/env node
// Builds only the packages used by the Dopame OS (acde) port: typings first, then the plugin
// bundles, then the web entry. Mirrors build-typings.mjs and build-modules.mjs without the
// Electron, SSH, serial and telnet packages, which need native modules.
import sh from 'shelljs'
import log from 'npmlog'
import webpack from 'webpack'
import { promisify } from 'node:util'

// Dependency order: each plugin's typings must exist before plugins that import it are built.
export const acdePlugins = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-local',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-linkifier',
]

const webpackConfigs = [
    ...acdePlugins.map(plugin => `../${plugin}/webpack.config.mjs`),
    '../web/webpack.config.mjs',
]

function buildTypings () {
    for (const plugin of acdePlugins) {
        log.info('typings', plugin)
        const result = sh.exec(`yarn tsc --project ${plugin}/tsconfig.typings.json`)
        if (result.code !== 0) {
            throw new Error(`typings failed for ${plugin}`)
        }
    }
}

async function buildBundles () {
    for (const configPath of webpackConfigs) {
        log.info('webpack', configPath)
        const config = (await import(configPath)).default()
        const stats = await promisify(webpack)(config)
        console.log(stats.toString({ colors: false, chunks: false, modules: false }))
        if (stats.hasErrors()) {
            throw new Error(`webpack failed for ${configPath}`)
        }
    }
}

// Copies the built web entry and plugin bundles into the acde app, where Vite serves them unchanged
// from public/. Each plugin keeps its package.json because Tabby's loader reads `main` from it.
function assemble () {
    const target = 'acde-app/public/tabby'
    log.info('assemble', target)
    sh.rm('-rf', target)
    sh.mkdir('-p', `${target}/plugins`)
    sh.cp('-R', 'web/dist/*', target)
    for (const plugin of acdePlugins) {
        sh.mkdir('-p', `${target}/plugins/${plugin}`)
        sh.cp(`${plugin}/package.json`, `${target}/plugins/${plugin}/`)
        sh.cp('-R', `${plugin}/dist`, `${target}/plugins/${plugin}/`)
    }
}

try {
    const step = process.argv[2] ?? 'all'
    if (step === 'all' || step === 'typings') {
        buildTypings()
    }
    if (step === 'all' || step === 'bundles') {
        await buildBundles()
    }
    if (step === 'all' || step === 'assemble') {
        assemble()
    }
} catch (error) {
    log.error('build-acde', String(error))
    process.exit(1)
}
