// SFTP for the russh stand-in, on ssh2's SFTP client. Metadata is returned in russh's shape
// (lib/sftp.d.ts); open files are kept by id with their read/write position.
import { randomUUID } from 'node:crypto'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000
const FILE_TYPE = { directory: 0, file: 1, symlink: 2, other: 3 }
// russh's open flags (lib/native.d.ts OPEN_*), as the page sends them.
const OPEN = { read: 1, write: 2, append: 4, create: 8, truncate: 16 }

function fileType (mode) {
    const kind = mode & S_IFMT
    if (kind === S_IFDIR) {
        return FILE_TYPE.directory
    }
    if (kind === S_IFREG) {
        return FILE_TYPE.file
    }
    return kind === S_IFLNK ? FILE_TYPE.symlink : FILE_TYPE.other
}

function metadata (attrs, longname) {
    // "-rw-r--r--    1 user  group  size ...": owner and group names only exist in the long name.
    const [, , user, group] = (longname ?? '').split(/\s+/)
    return {
        size: Number(attrs.size ?? 0),
        type: fileType(attrs.mode ?? 0),
        uid: attrs.uid,
        gid: attrs.gid,
        user,
        group,
        permissions: (attrs.mode ?? 0) & 0o7777,
        atime: attrs.atime,
        mtime: attrs.mtime,
    }
}

/** ssh2's string flags for russh's OPEN_* bits. */
export function openFlags (mode) {
    const read = Boolean(mode & OPEN.read)
    const write = Boolean(mode & (OPEN.write | OPEN.append))
    if (!write) {
        return 'r'
    }
    if (mode & OPEN.append) {
        return read ? 'a+' : 'a'
    }
    if (mode & (OPEN.create | OPEN.truncate)) {
        return read ? 'w+' : 'w'
    }
    return 'r+'
}

function promised (fn) {
    return new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))))
}

export class SftpSession {
    constructor (sftp) {
        this.sftp = sftp
        this.files = new Map()
    }

    static open (client) {
        return promised(done => client.sftp(done)).then(sftp => new SftpSession(sftp))
    }

    async readDirectory (path) {
        const entries = await promised(done => this.sftp.readdir(path, done))
        return entries.map(entry => ({ name: entry.filename, metadata: metadata(entry.attrs, entry.longname) }))
    }

    async stat (path) {
        return metadata(await promised(done => this.sftp.stat(path, done)))
    }

    createDirectory (path) {
        return promised(done => this.sftp.mkdir(path, done))
    }

    removeDirectory (path) {
        return promised(done => this.sftp.rmdir(path, done))
    }

    removeFile (path) {
        return promised(done => this.sftp.unlink(path, done))
    }

    readlink (path) {
        return promised(done => this.sftp.readlink(path, done))
    }

    rename (src, dst) {
        return promised(done => this.sftp.rename(src, dst, done))
    }

    chmod (path, mode) {
        return promised(done => this.sftp.chmod(path, typeof mode === 'string' ? parseInt(mode, 8) : mode, done))
    }

    async openFile (path, mode) {
        const handle = await promised(done => this.sftp.open(path, openFlags(mode), done))
        const id = randomUUID()
        this.files.set(id, { handle, position: 0 })
        return id
    }

    file (id) {
        const file = this.files.get(id)
        if (!file) {
            throw new Error(`no open file ${id}`)
        }
        return file
    }

    /** Up to `length` bytes from the current position; empty at the end of the file. */
    async readFile (id, length) {
        const file = this.file(id)
        const buffer = Buffer.alloc(length)
        const bytesRead = await new Promise((resolve, reject) => {
            this.sftp.read(file.handle, buffer, 0, length, file.position, (error, count) => {
                // ssh2 reports the end of the file as an error with code 1 (SSH_FX_EOF).
                if (error && error.code !== 1) {
                    reject(error)
                    return
                }
                resolve(error ? 0 : count)
            })
        })
        file.position += bytesRead
        return buffer.subarray(0, bytesRead)
    }

    async writeFile (id, data) {
        const file = this.file(id)
        await promised(done => this.sftp.write(file.handle, data, 0, data.length, file.position, done))
        file.position += data.length
    }

    async closeFile (id) {
        const file = this.files.get(id)
        if (!file) {
            return
        }
        this.files.delete(id)
        await promised(done => this.sftp.close(file.handle, done))
    }

    async close () {
        await Promise.all([...this.files.keys()].map(id => this.closeFile(id)))
        this.sftp.end()
    }
}
