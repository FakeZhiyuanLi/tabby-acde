// What tabby-ssh expects from Node.js for SSH agent sign-in, answered by the app's acde backend:
// process.env.SSH_AUTH_SOCK, and fs/promises.stat to check that the path is a socket.

/** Sets process.env.SSH_AUTH_SOCK in the page to the user's agent socket, when there is one. */
export async function exposeAgentSocket () {
    try {
        const { path } = await (await fetch('/api/russh/agent')).json()
        if (path) {
            window.process.env = { ...window.process.env, SSH_AUTH_SOCK: path }
        }
    } catch (error) {
        console.warn('tabby-acde: could not look up the SSH agent', error)
    }
}

function statResult (answer) {
    return {
        isSocket: () => answer.socket,
        isFile: () => answer.file,
        isDirectory: () => answer.directory,
        isSymbolicLink: () => false,
    }
}

/** The file's type from the backend, or { exists: false, code }. Never the contents. */
export async function statFromBackend (path) {
    const response = await fetch('/api/russh/stat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: String(path) }),
    })
    const answer = await response.json()
    return answer.exists ? { exists: true, stats: statResult(answer) } : answer
}

/** fs/promises with stat only (file type, never contents); everything else stays unavailable. */
export const fsPromises = {
    async stat (path) {
        const answer = await statFromBackend(path)
        if (!answer.exists) {
            throw Object.assign(new Error(`${answer.code}: no such file, stat '${path}'`), { code: answer.code })
        }
        return answer.stats
    },
}
