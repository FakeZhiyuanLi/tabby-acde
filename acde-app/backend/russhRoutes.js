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
import { getSocket, openSocket } from './netSockets.js'
import { connect, findAgentSocket, getConnection, parseKey, statPath } from './russhBridge.js'

//   POST /api/russh/connections/:id/sftp/:n/:op        op: activate close readDirectory stat createDirectory
//                                                        removeDirectory removeFile readlink rename chmod open
//   POST /api/russh/connections/:id/sftp/:n/files/:f/:op op: read ({ length } -> bytes) write (bytes) close
const SFTP_PATH = /^\/api\/russh\/connections\/([0-9a-f-]{36})\/sftp\/(\d+)\/(?:files\/([0-9a-f-]{36})\/(read|write|close)|(activate|close|readDirectory|stat|createDirectory|removeDirectory|removeFile|readlink|rename|chmod|open))$/
const MAX_READ = 1024 * 1024
const CONNECTION_PATH =/^\/api\/russh\/connections\/([0-9a-f-]{36})(?:\/(events|host-key|handshake|auth|keyboard-interactive|disconnect|channels|forward-channel|forward-port|stop-forward)(?:\/(\d+)\/(activate|pty|shell|exec|write|resize|eof|close))?)?$/
//   POST /api/russh/sockets                            { host, port } -> { id }   (outgoing TCP for net.Socket)
//   GET  /api/russh/sockets/:id/events                 NDJSON: connect, data, end, error, close
//   POST /api/russh/sockets/:id/:op                    op: write (bytes) end destroy
const SOCKET_PATH = /^\/api\/russh\/sockets\/([0-9a-f-]{36})\/(events|write|end|destroy)$/

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
    if (op === 'activate') {
        connection.activateChannel(channel)
    } else if (op === 'pty') {
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

async function socketOp (id, op, request) {
    const socket = getSocket(id)
    if (!socket) {
        return json({ error: 'no such socket' }, 404)
    }
    if (op === 'events') {
        return new Response(socket.eventStream(), { headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    if (op === 'write') {
        await socket.write(Buffer.from(await request.arrayBuffer()))
    } else if (op === 'end') {
        socket.end()
    } else {
        socket.destroy()
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
        return new Response(connection.eventStream(), { headers: { 'Content-Type': 'application/x-ndjson' } })
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
    if (action === 'forward-channel') {
        return json({ channel: await connection.openTCPForwardChannel((await body(request)).options ?? {}) })
    }
    if (action === 'forward-port' || action === 'stop-forward') {
        const { address, port } = await body(request)
        if (action === 'stop-forward') {
            await connection.stopForwardingTCPPort(address, port)
            return new Response(null, { status: 204 })
        }
        return json({ port: await connection.forwardTCPPort(address, port) })
    }
    if (action === 'disconnect') {
        connection.end()
        return new Response(null, { status: 204 })
    }
    return json({ error: 'not found' }, 404)
}

/** Handles /api/russh/*; null for other paths. */
export async function handleRussh (request, pathname) {
    if (!pathname.startsWith('/api/russh/')) {
        return null
    }
    // Event streams are read with GET (and only once); everything else is a POST.
    const expected = pathname.endsWith('/events') || pathname === '/api/russh/agent' ? 'GET' : 'POST'
    if (request.method !== expected) {
        return json({ error: `use ${expected}` }, 405)
    }
    try {
        if (pathname === '/api/russh/agent') {
            return json({ path: await findAgentSocket() })
        }
        if (pathname === '/api/russh/stat') {
            const path = String((await body(request)).path ?? '')
            return json(path.startsWith('/') ? await statPath(path) : { exists: false, code: 'EINVAL' })
        }
        if (pathname === '/api/russh/keys/parse') {
            const { data, passphrase } = await body(request)
            return json(parseKey(String(data ?? ''), passphrase))
        }
        if (pathname === '/api/russh/connections') {
            const { transport, config } = await body(request)
            return json({ id: connect(transport, config).id })
        }
        if (pathname === '/api/russh/sockets') {
            const { host, port } = await body(request)
            if (typeof host !== 'string' || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
                return json({ error: 'host must be a name or address and port a number from 1 to 65535' }, 400)
            }
            return json({ id: openSocket(host, port).id })
        }
        const socketMatch = pathname.match(SOCKET_PATH)
        if (socketMatch) {
            return await socketOp(socketMatch[1], socketMatch[2], request)
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
