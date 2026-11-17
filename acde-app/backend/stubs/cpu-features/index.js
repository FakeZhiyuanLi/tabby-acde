// acde backends are bundled into pure JS, so the native add-on is not available. ssh2 calls this
// inside try/catch and then picks its ciphers without CPU feature detection.
module.exports = function cpuFeatures () {
    throw new Error('cpu-features is not available in the acde backend')
}
