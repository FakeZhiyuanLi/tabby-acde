// Checks a server's host key against ~/.ssh/known_hosts, including hashed entries (|1|salt|hash).
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function hostToken (host, port) {
    return port === 22 ? host : `[${host}]:${port}`
}

function hashedMatches (entry, token) {
    const [, , salt, hash] = entry.split('|')
    if (!salt || !hash) {
        return false
    }
    const digest = createHmac('sha1', Buffer.from(salt, 'base64')).update(token).digest('base64')
    return digest === hash
}

function entryMatches (hostsField, token) {
    return hostsField.split(',').some(entry => entry.startsWith('|1|') ? hashedMatches(entry, token) : entry.toLowerCase() === token.toLowerCase())
}

/**
 * 'match' when known_hosts has this key for the host, 'mismatch' when it has other keys for the
 * host (and not this one) or revokes this key, 'unknown' when the host is not listed.
 */
export function checkHostKey (host, port, keyBlob, knownHostsPath = join(homedir(), '.ssh', 'known_hosts')) {
    let text = ''
    try {
        text = readFileSync(knownHostsPath, 'utf8')
    } catch {
        return 'unknown'
    }
    const token = hostToken(host, port)
    const key = keyBlob.toString('base64')
    let listed = false
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) {
            continue
        }
        const fields = line.split(/\s+/)
        if (fields[0].startsWith('@')) {
            if (fields[0] === '@revoked' && fields[3] === key && entryMatches(fields[1], token)) {
                return 'mismatch'
            }
            continue
        }
        const [hostsField, , listedKey] = fields
        if (!listedKey || !entryMatches(hostsField, token)) {
            continue
        }
        if (listedKey === key) {
            return 'match'
        }
        listed = true
    }
    return listed ? 'mismatch' : 'unknown'
}
