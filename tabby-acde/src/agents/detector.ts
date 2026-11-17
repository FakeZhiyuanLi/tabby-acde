// Recognises coding-agent CLIs from what they print. Matching screen text is the approach Herdr
// uses for agents that do not report their state; phrases come from the agents' own UIs.

export type AgentState = 'idle' | 'working' | 'waiting' | 'done'
export type AgentSignal = 'working' | 'waiting'

const ANSI_ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g

// Shown while an agent is busy (Claude Code, Codex and others print "esc to interrupt").
const WORKING_PATTERN = /esc to (?:interrupt|cancel)/gi

// Shown when an agent stops to ask for approval or input.
const WAITING_PATTERN = /do you want to (?:proceed|make this edit|run|create)|allow (?:this|command)|waiting for (?:your )?(?:input|approval)|\(y\/n\)|❯ 1\. yes/gi

const AGENT_NAMES: [RegExp, string][] = [
    [/claude code/i, 'Claude Code'],
    [/\bcodex\b/i, 'Codex'],
    [/gemini cli/i, 'Gemini CLI'],
    [/demo-agent/i, 'Demo agent'],
]

export function stripAnsi (text: string): string {
    return text.replace(ANSI_ESCAPES, '')
}

function lastMatchIndex (text: string, pattern: RegExp): number {
    let index = -1
    for (const match of text.matchAll(pattern)) {
        index = match.index ?? index
    }
    return index
}

/** The latest agent signal in a piece of terminal text, or null when it shows none. */
export function lastSignal (text: string): AgentSignal | null {
    const working = lastMatchIndex(text, WORKING_PATTERN)
    const waiting = lastMatchIndex(text, WAITING_PATTERN)
    if (working < 0 && waiting < 0) {
        return null
    }
    return waiting > working ? 'waiting' : 'working'
}

/** The agent's name if its banner or prompt appears in the text. */
export function agentName (text: string): string | null {
    for (const [pattern, name] of AGENT_NAMES) {
        if (pattern.test(text)) {
            return name
        }
    }
    return null
}
