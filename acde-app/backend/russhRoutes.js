// HTTP routes for the russh stand-in. All bodies are JSON except channel writes (raw bytes).
//   GET  /api/russh/agent                              -> { path } of the SSH agent socket, or null
//   POST /api/russh/stat                               { path } -> { exists, socket, file, directory }
//   POST /api/russh/keys/parse                        { data, passphrase } -> { algorithm } | { error, encrypted }
//   POST /api/russh/connections                        { transport, config } -> { id }
//   GET  /api/russh/connections/:id/events             NDJSON event stream
//   POST /api/russh/connections/:id/host-key           { accept }
//   POST /api/russh/connections/:id/handshake          waits until authentication can start
//   POST /api/russh/connections/:id/auth               { method } -> { result, ... }
//   POST /api/russh/connections/:id/keyboard-interactive { responses } -> { result, ... }
//   POST /api/russh/connections/:id/channels           -> { channel }
//   POST /api/russh/connections/:id/channels/:n/:op    op: pty shell exec write resize eof close
//   POST /api/russh/connections/:id/disconnect
import { connect, findAgentSocket, getConnection, parseKey, statPath } from './russhBridge.js'

//   POST /api/russh/connections/:id/sftp/:n/:op        op: activate close readDirectory stat createDirectory
//                                                        removeDirectory removeFile readlink rename chmod open
//   POST /api/russh/connections/:id/sftp/:n/files/:f/:op op: read ({ length } -> bytes) write (bytes) close
const SFTP_PATH = /^\/api\/russh\/connections\/([0-9a-f-]{36})\/sftp\/(\d+)\/(?:files\/([0-9a-f-]{36})\/(read|write|close)|(activate|close|readDirectory|stat|createDirectory|removeDirectory|removeFile|readlink|rename|chmod|open))$/
const MAX_READ = 1024 * 1024
const CONNECTION_PATH =/^\/api\/russh\/connections\/([0-9a-f-]{36})(?:\/(events|host-key|handshake|auth|keyboard-interactive|disconnect|channels)(?:\/(\d+)\/(pty|shell|exec|write|resize|eof|close))?)?$/

function json (body, status = 200) {
    return Response.json(body, { status })
}

async function body (request) {
    return request.json().catch(() => ({}))
}

async function channelOp (connection, channel, op, request) {
    if (op === 'write') {
        connection.write(channel, Buffer.from(await request.arrayBuffer()))
        return new Response(null, { status: 204 })
    }
    const input = await body(request)
    if (op === 'pty') {
        connection.requestPTY(channel, { term: input.term, ...input.size })
    } else if (op === 'shell') {
        await connection.requestShell(channel)
    } else if (op === 'exec') {
        await connection.requestExec(channel, String(input.command ?? ''))
    } else if (op === 'resize') {
        connection.resize(channel, input.size ?? {})
    } else if (op === 'eof') {
        connection.eof(channel)
    } else {
        connection.closeChannel(channel)
    }
    return new Response(null, { status: 204 })
}

async function sftpFileOp (session, file, op, request) {
    if (op === 'read') {
        const length = Math.min(Math.max(Number((await body(request)).length) || 0, 1), MAX_READ)
        return new Response(await session.readFile(file, length), { headers: { 'Content-Type': 'application/octet-stream' } })
    }
    if (op === 'write') {
        await session.writeFile(file, Buffer.from(await request.arrayBuffer()))
    } else {
        await session.closeFile(file)
    }
    return new Response(null, { status: 204 })
}

async function sftpOp (connection, channel, op, request) {
    if (op === 'activate') {
        await connection.activateSFTP(channel)
        return new Response(null, { status: 204 })
    }
    if (op === 'close') {
        await connection.closeSFTP(channel)
        return new Response(null, { status: 204 })
    }
    const session = connection.sftp(channel)
    const { path, src, dst, mode } = await body(request)
    if (op === 'readDirectory') {
        return json(await session.readDirectory(path))
    }
    if (op === 'stat') {
        return json(await session.stat(path))
    }
    if (op === 'readlink') {
        return json({ target: await session.readlink(path) })
    }
    if (op === 'open') {
        return json({ file: await session.openFile(path, mode) })
    }
    if (op === 'rename') {
        await session.rename(src, dst)
    } else if (op === 'chmod') {
        await session.chmod(path, mode)
    } else {
        await session[op](path)
    }
    return new Response(null, { status: 204 })
}

async function connectionOp (connection, action, request) {
    if (action === 'events') {
        return new Response(connection.events(), { headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    if (action === 'host-key') {
        connection.answerHostKey((await body(request)).accept)
        return new Response(null, { status: 204 })
    }
    if (action === 'handshake') {
        await connection.handshake
        return json({ ok: true })
    }
    if (action === 'auth') {
        return json(await connection.authenticate((await body(request)).method ?? {}))
    }
    if (action === 'keyboard-interactive') {
        return json(await connection.continueKeyboardInteractive((await body(request)).responses ?? []))
    }
    if (action === 'channels') {
        return json({ channel: connection.openSessionChannel() })
    }
    connection.end()
    return new Response(null, { status: 204 })
}

/** Handles /api/russh/*; null for other paths. */
export async function handleRussh (request, pathname) {
    if (!pathname.startsWith('/api/russh/') || request.method !== 'POST' && request.method !== 'GET') {
        return null
    }
    try {
        if (pathname === '/api/russh/agent') {
            return json({ path: await findAgentSocket() })
        }
        if (pathname === '/api/russh/stat') {
            return json(await statPath(String((await body(request)).path ?? '')))
        }
        if (pathname === '/api/russh/keys/parse') {
            const { data, passphrase } = await body(request)
            return json(parseKey(String(data ?? ''), passphrase))
        }
        if (pathname === '/api/russh/connections') {
            const { transport, config } = await body(request)
            return json({ id: connect(transport, config).id })
        }
        const sftpMatch = pathname.match(SFTP_PATH)
        if (sftpMatch) {
            const owner = getConnection(sftpMatch[1])
            if (!owner) {
                return json({ error: 'no such connection' }, 404)
            }
            const channel = Number(sftpMatch[2])
            return sftpMatch[3]
                ? await sftpFileOp(owner.sftp(channel), sftpMatch[3], sftpMatch[4], request)
                : await sftpOp(owner, channel, sftpMatch[5], request)
        }
        const match = pathname.match(CONNECTION_PATH)
        const connection = match && getConnection(match[1])
        if (!connection) {
            return json({ error: 'no such connection' }, 404)
        }
        if (match[3]) {
            return await channelOp(connection, Number(match[3]), match[4], request)
        }
        return await connectionOp(connection, match[2], request)
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
}
