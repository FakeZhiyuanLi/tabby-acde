// Starts Tabby inside an acde window: loads the plugin bundles that build-acde.mjs copied into
// public/tabby, then bootstraps Angular with a connector (the web build's host interface).
import { fs } from 'acde:fs'
import { terminal } from 'acde:terminal'
import { window as acdeWindow } from 'acde:window'

// Load order matters: tabby-acde comes after tabby-web so its window service takes precedence.
const PLUGIN_NAMES = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-local',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-linkifier',
    'tabby-acde',
]
const PLUGIN_BASE_URL = '/tabby/plugins'
const APP_VERSION = '1.0.238-acde'
const CONFIG_ROOT = 'private'
const CONFIG_PATH = 'tabby/config.yaml'

// Tabby's config is a YAML file in the app's private folder, the acde equivalent of
// ~/.config/tabby/config.yaml. A missing file means first run: Tabby starts from its defaults.
async function loadConfig () {
    try {
        return (await fs.readText(CONFIG_ROOT, CONFIG_PATH)).text
    } catch (error) {
        console.info('tabby-acde: no saved config yet', error?.message ?? error)
        return ''
    }
}

async function saveConfig (content) {
    await fs.writeFile(CONFIG_ROOT, CONFIG_PATH, content, { mkdirs: true })
}

function createConnector () {
    return {
        loadConfig,
        saveConfig,
        getAppVersion: () => APP_VERSION,
        createSocket: () => { throw new Error('Network sockets are not available in the acde port') },
    }
}

// Modules the plugin bundles require that Tabby's web preload does not provide: the acde modules
// tabby-acde uses, and 'node:url', which the chunk loader of webpack 5.110's node target requires.
function registerHostModules (tabby) {
    // tabby-local checks working directories with fs.statSync and resolves them with fs.realpath,
    // but a page has no file system. Treat every path as a folder: the shell's own `cd` reports a
    // missing one. This replaces the web preload's fs mock, which made every folder invalid.
    const folder = { isDirectory: () => true }
    tabby.registerMock('fs', {
        statSync: () => folder,
        stat: (_path, callback) => callback(null, folder),
        realpath: (path, callback) => callback(null, path),
        realpathSync: (path) => path,
        readdir: (_path, callback) => callback(null, []),
        rmdirSync: () => null,
        appendFile: (_path, _data, callback) => callback?.(null),
        existsSync: () => false,
        constants: {},
    })
    tabby.registerModule('acde:terminal', { terminal })
    tabby.registerModule('acde:window', { window: acdeWindow })
    tabby.registerModule('node:url', {
        pathToFileURL: (path) => new URL(path, window.location.href),
        fileURLToPath: (url) => new URL(url).pathname,
    })
}

function showProgress (done, total) {
    const bar = document.querySelector('.preload-logo .bar')
    if (bar) bar.style.width = `${Math.round((100 * done) / total)}%`
}

async function pluginInfo (name) {
    const pkg = await (await fetch(`${PLUGIN_BASE_URL}/${name}/package.json`)).json()
    return {
        name: pkg.name,
        packageName: pkg.name,
        description: pkg.description ?? '',
        version: pkg.version ?? APP_VERSION,
        author: pkg.author ?? '',
        isBuiltin: true,
        isLegacy: false,
        path: `${PLUGIN_BASE_URL}/${name}`,
    }
}

async function boot () {
    const tabby = window.Tabby
    if (!tabby) throw new Error('Tabby preload did not run: check that /tabby/preload.js loaded')

    const connector = createConnector()
    window.__connector__ = connector
    registerHostModules(tabby)

    const urls = PLUGIN_NAMES.map(name => `${PLUGIN_BASE_URL}/${name}`)
    const packageModules = await tabby.loadPlugins(urls, showProgress)
    packageModules.forEach((module, index) => { module.pluginName = PLUGIN_NAMES[index] })

    const bootstrapData = {
        config: {},
        executable: 'tabby',
        isMainWindow: true,
        windowID: 1,
        installedPlugins: await Promise.all(PLUGIN_NAMES.map(pluginInfo)),
        userPluginsPath: '/',
    }
    // acde dev runs Vite in development mode; acde build produces the production bundle, where Angular
    // skips its development-only checks.
    await tabby.bootstrap({ packageModules, bootstrapData, debugMode: import.meta.env.DEV, connector })
    console.log('tabby-acde: Tabby bootstrapped')
}

boot().catch((error) => {
    console.error('tabby-acde: boot failed', error)
    const title = document.querySelector('.tabby-title')
    if (title) title.textContent = `Tabby failed to start: ${error.message}`
})
