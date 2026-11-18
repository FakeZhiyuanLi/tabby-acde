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

const CONNECTION_PATH = /^\/api\/russh\/connections\/([0-9a-f-]{36})(?:\/(events|host-key|handshake|auth|keyboard-interactive|disconnect|channels)(?:\/(\d+)\/(pty|shell|exec|write|resize|eof|close))?)?$/

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
