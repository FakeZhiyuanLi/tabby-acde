import * as path from 'path'
import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => config({
    name: 'acde',
    dirname: __dirname,
    // acde:* modules exist only inside the acde runtime; the host page registers them with
    // Tabby's module loader, so the bundle must require them at run time.
    externals: [/^acde:/],
})
