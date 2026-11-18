// Tabby's acde backend: SSH sessions for the page, since a page cannot open TCP connections.
//   POST   /api/ssh/sessions              { host, cols, rows } -> { id }
//   GET    /api/ssh/sessions/:id/output   streaming terminal output
//   POST   /api/ssh/sessions/:id/input    raw bytes typed into the session
//   POST   /api/ssh/sessions/:id/resize   { cols, rows }
//   DELETE /api/ssh/sessions/:id
import './cjsGlobals.js'
import { handleRussh } from './russhRoutes.js'
import { getSession, openSession } from './sessions.js'

const HOST_PATTERN = /^[A-Za-z0-9._@:-]{1,255}$/
const MAX_SIZE = 1000

function validSize (value) {
    return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
}

function error (status, message) {
    return Response.json({ error: message }, { status })
}

async function create (request) {
    const body = await request.json().catch(() => null)
    if (!body || typeof body.host !== 'string' || !HOST_PATTERN.test(body.host)) {
        return error(400, 'host must be a host name or ssh config alias')
    }
    if (!validSize(body.cols) || !validSize(body.rows)) {
        return error(400, 'cols and rows must be whole numbers from 1 to 1000')
    }
    const session = openSession(body.host, body.cols, body.rows)
    return Response.json({ id: session.id, target: session.target.hostname })
}

async function act (session, action, request) {
    if (action === 'output' && request.method === 'GET') {
        return new Response(session.output(), { headers: { 'Content-Type': 'application/octet-stream' } })
    }
    if (action === 'input' && request.method === 'POST') {
        session.input(Buffer.from(await request.arrayBuffer()))
        return new Response(null, { status: 204 })
    }
    if (action === 'resize' && request.method === 'POST') {
        const { cols, rows } = await request.json().catch(() => ({}))
        if (!validSize(cols) || !validSize(rows)) {
            return error(400, 'cols and rows must be whole numbers from 1 to 1000')
        }
        session.resize(cols, rows)
        return new Response(null, { status: 204 })
    }
    if (!action && request.method === 'DELETE') {
        session.end()
        return new Response(null, { status: 204 })
    }
    return error(404, 'not found')
}

export default {
    async fetch (request) {
        const { pathname } = new URL(request.url)
        const russhResponse = await handleRussh(request, pathname)
        if (russhResponse) {
            return russhResponse
        }
        if (pathname === '/api/ssh/sessions' && request.method === 'POST') {
            return create(request)
        }
        const match = pathname.match(/^\/api\/ssh\/sessions\/([0-9a-f-]{36})(?:\/(output|input|resize))?$/)
        if (!match) {
            return error(404, 'not found')
        }
        const session = getSession(match[1])
        if (!session) {
            return error(404, 'no such session')
        }
        return act(session, match[2], request)
    },
}
