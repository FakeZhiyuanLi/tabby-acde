// Events for the page as an NDJSON stream with exactly one reader (a second reader would steal the
// first one's wake-up and leave it hanging, so it is refused).
//
// The sources that feed a queue (SSH channels, sockets) are paused while more than HIGH_WATER_BYTES
// wait for the reader, so a fast server slows down to the page's pace instead of filling memory: a
// paused ssh2 channel stops granting window, and a paused socket stops reading.
export const HIGH_WATER_BYTES = 1024 * 1024

export class EventQueue {
    constructor () {
        this.lines = []
        this.queuedBytes = 0
        this.sources = new Set()
        this.paused = false
        this.wake = null
        this.closed = false
        this.streaming = false
    }

    push (event) {
        const line = JSON.stringify(event) + '\n'
        this.lines.push(line)
        this.queuedBytes += line.length
        if (this.queuedBytes > HIGH_WATER_BYTES && !this.paused) {
            this.paused = true
            this.sources.forEach(source => source.pause())
        }
        this.wake?.()
    }

    /** A readable (with pause() and resume()) whose data this queue carries. */
    addSource (source) {
        this.sources.add(source)
        if (this.paused) {
            source.pause()
        }
    }

    removeSource (source) {
        this.sources.delete(source)
    }

    close () {
        this.closed = true
        this.wake?.()
    }

    /** The stream; onCancel runs when the page stops reading. Throws if a reader already exists. */
    stream (onCancel) {
        if (this.streaming) {
            throw new Error('this event stream already has a reader')
        }
        this.streaming = true
        const encoder = new TextEncoder()
        return new ReadableStream({
            pull: async controller => {
                while (!this.lines.length && !this.closed) {
                    await new Promise(resolve => { this.wake = resolve })
                }
                if (this.lines.length) {
                    const text = this.lines.splice(0).join('')
                    this.queuedBytes = 0
                    this.resumeSources()
                    controller.enqueue(encoder.encode(text))
                } else {
                    controller.close()
                }
            },
            cancel: () => onCancel?.(),
        })
    }

    resumeSources () {
        if (!this.paused) {
            return
        }
        this.paused = false
        this.sources.forEach(source => source.resume())
    }
}
