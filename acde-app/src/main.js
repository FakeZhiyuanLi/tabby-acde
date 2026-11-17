// Starts Tabby inside an acde window: loads the plugin bundles that build-acde.mjs copied into
// public/tabby, then bootstraps Angular with a connector (the web build's host interface).
const PLUGIN_NAMES = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    // tabby-local returns in phase 4, once tabby-acde provides its ShellProvider and PTYInterface.
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-linkifier',
]
const PLUGIN_BASE_URL = '/tabby/plugins'
const APP_VERSION = '1.0.238-acde'

// Spike connector: config lives in memory. Phase 4 replaces it with the app's private folder.
function createConnector () {
    let configText = ''
    return {
        loadConfig: async () => configText,
        saveConfig: async (content) => { configText = content },
        getAppVersion: () => APP_VERSION,
        createSocket: () => { throw new Error('Network sockets are not available in the acde port') },
    }
}

// Modules the plugin bundles require that Tabby's web preload does not provide. webpack 5.110
// builds the plugins for the node target, whose chunk loader requires 'node:url'.
function registerHostModules (tabby) {
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
    await tabby.bootstrap({ packageModules, bootstrapData, debugMode: true, connector })
    console.log('tabby-acde: Tabby bootstrapped')
}

boot().catch((error) => {
    console.error('tabby-acde: boot failed', error)
    const title = document.querySelector('.tabby-title')
    if (title) title.textContent = `Tabby failed to start: ${error.message}`
})
