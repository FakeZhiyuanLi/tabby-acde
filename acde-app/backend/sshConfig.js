// Resolves a host alias the way OpenSSH reads ~/.ssh/config: for each option the first value
// that applies wins. Supports Host patterns with * and ?, and negated patterns.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OPTIONS = new Set(['hostname', 'user', 'port', 'identityfile', 'hostkeyalias'])

function patternToRegExp (pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`, 'i')
}

function hostMatches (patterns, alias) {
    let matched = false
    for (const pattern of patterns) {
        const negated = pattern.startsWith('!')
        if (patternToRegExp(negated ? pattern.slice(1) : pattern).test(alias)) {
            if (negated) {
                return false
            }
            matched = true
        }
    }
    return matched
}

function parseBlocks (text) {
    const blocks = []
    let current = null
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) {
            continue
        }
        const [key, ...rest] = line.split(/\s+|=/).filter(Boolean)
        const value = rest.join(' ').replace(/^"(.*)"$/, '$1')
        if (key.toLowerCase() === 'host') {
            current = { patterns: rest, options: [] }
            blocks.push(current)
        } else if (current && OPTIONS.has(key.toLowerCase())) {
            current.options.push([key.toLowerCase(), value])
        }
    }
    return blocks
}

function expandHome (path) {
    return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/** { alias, hostname, port, user, identityFiles, hostKeyAlias } for an alias or host name. */
export function resolveHost (alias, configPath = join(homedir(), '.ssh', 'config')) {
    let text = ''
    try {
        text = readFileSync(configPath, 'utf8')
    } catch {
        // No config file: the alias is the host name.
    }
    const resolved = { identityFiles: [] }
    for (const block of parseBlocks(text)) {
        if (!hostMatches(block.patterns, alias)) {
            continue
        }
        for (const [key, value] of block.options) {
            if (key === 'identityfile') {
                resolved.identityFiles.push(expandHome(value))
            } else if (resolved[key] === undefined) {
                resolved[key] = value
            }
        }
    }
    return {
        alias,
        hostname: resolved.hostname ?? alias,
        port: Number(resolved.port ?? 22),
        user: resolved.user ?? process.env.USER ?? null,
        identityFiles: resolved.identityFiles,
        hostKeyAlias: resolved.hostkeyalias ?? null,
    }
}
