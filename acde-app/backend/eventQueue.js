// Events for the page as an NDJSON stream with exactly one reader (a second reader would steal the
// first one's wake-up and leave it hanging, so it is refused).
export class EventQueue {
    constructor () {
        this.lines = []
        this.wake = null
        this.closed = false
        this.streaming = false
    }

    push (event) {
        this.lines.push(JSON.stringify(event) + '\n')
        this.wake?.()
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
                    controller.enqueue(encoder.encode(this.lines.splice(0).join('')))
                } else {
                    controller.close()
                }
            },
            cancel: () => onCancel?.(),
        })
    }
}
