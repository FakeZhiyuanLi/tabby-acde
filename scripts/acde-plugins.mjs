// The packages the Dopame OS (acde) port builds and loads, in dependency order: each plugin's
// typings must exist before plugins that import it are built. Shared by build-acde.mjs and
// install-acde-deps.mjs; kept free of dependencies so it can be imported before anything is installed.
export const acdePlugins = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-local',
    'tabby-ssh',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-linkifier',
    'tabby-acde',
]
