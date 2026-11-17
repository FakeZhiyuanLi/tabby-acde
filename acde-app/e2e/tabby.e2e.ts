// End-to-end tests for Tabby on Dopame OS. Each test runs in a fresh acde session with its own
// HOME, so a shell command's side effects can be checked on disk through the `home` fixture.
import { test, expect, type AppWindow } from 'acde/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Tabby's bundles are large; the session start counts against each test's time.
const TEST_TIMEOUT_MS = 120_000
const BOOT_TIMEOUT_MS = 45_000
const STEP_TIMEOUT_MS = 15_000
// How long a staged command is given to (wrongly) run before we check that it did not.
const NOT_RUN_GRACE_MS = 1_500

const DEMO_AGENT = fileURLToPath(new URL('../../scripts/demo-agent.sh', import.meta.url))

async function waitForTabby (app: AppWindow): Promise<void> {
    await expect(app.getByRole('button', { name: 'New terminal' })).toBeVisible({ timeout: BOOT_TIMEOUT_MS })
}

async function openTerminal (app: AppWindow): Promise<void> {
    await app.getByRole('button', { name: 'New terminal' }).click()
    await expect(app.locator('textarea.xterm-helper-textarea').last()).toBeFocused({ timeout: STEP_TIMEOUT_MS })
}

// insertText commits the command as an input method would. keyboard.type sends key presses, and
// through xterm.js shifted characters (", >, $, _) arrived out of order or not at all.
async function runInTerminal (app: AppWindow, command: string): Promise<void> {
    await app.keyboard.insertText(command)
    await app.keyboard.press('Enter')
}

// Sends Tabby a request the way another app or agent would, from inside the page.
async function sendRequest (app: AppWindow, request: Record<string, unknown>): Promise<void> {
    await app.evaluate(`import('acde:open').then(({ open }) => open('tabby', ${JSON.stringify(request)})).then(() => true)`)
}

async function chooseMenuItem (app: AppWindow, menu: string, item: string): Promise<void> {
    await app.getByRole('menuitem', { name: menu }).click()
    await app.getByRole('menuitem', { name: item }).click()
}

test('starts with its toolbar and named buttons', { timeout: TEST_TIMEOUT_MS }, async ({ app }) => {
    await waitForTabby(app!)
    await expect(app!.getByRole('button', { name: 'Profiles & connections' })).toBeVisible()
    await expect(app!.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('runs a command in a local shell on acde:terminal', { timeout: TEST_TIMEOUT_MS }, async ({ app, home }) => {
    await waitForTabby(app!)
    await openTerminal(app!)
    await runInTerminal(app!, 'echo shell-ok > "$HOME/shell-proof.txt"')
    await expect.poll(() => existsSync(join(home, 'shell-proof.txt')), { timeout: STEP_TIMEOUT_MS }).toBe(true)
})

test('opens settings from the File menu', { timeout: TEST_TIMEOUT_MS }, async ({ app }) => {
    await waitForTabby(app!)
    await chooseMenuItem(app!, 'File', 'Settings')
    await expect(app!.getByRole('heading', { name: 'Application settings' })).toBeVisible({ timeout: STEP_TIMEOUT_MS })
})

test('splits the terminal from the View menu', { timeout: TEST_TIMEOUT_MS }, async ({ app }) => {
    await waitForTabby(app!)
    await openTerminal(app!)
    await chooseMenuItem(app!, 'View', 'Split right')
    await expect(app!.locator('textarea.xterm-helper-textarea')).toHaveCount(2, { timeout: STEP_TIMEOUT_MS })
})

test('stages a run request without running it until the user presses Enter', { timeout: TEST_TIMEOUT_MS }, async ({ app, home }) => {
    await waitForTabby(app!)
    const proof = join(home, 'run-proof')
    await sendRequest(app!, { kind: 'run', command: 'touch "$HOME/run-proof"', title: 'Agent: e2e' })
    await expect(app!.getByText('Agent: e2e').first()).toBeVisible({ timeout: STEP_TIMEOUT_MS })

    await new Promise(resolve => setTimeout(resolve, NOT_RUN_GRACE_MS))
    expect(existsSync(proof)).toBe(false)

    await app!.keyboard.press('Enter')
    await expect.poll(() => existsSync(proof), { timeout: STEP_TIMEOUT_MS }).toBe(true)
})

test('rejects a run request whose command contains a newline', { timeout: TEST_TIMEOUT_MS }, async ({ app }) => {
    await waitForTabby(app!)
    await sendRequest(app!, { kind: 'run', command: 'echo one\necho two', title: 'Agent: rejected' })
    await new Promise(resolve => setTimeout(resolve, NOT_RUN_GRACE_MS))
    await expect(app!.getByText('Agent: rejected')).toHaveCount(0)
})

test('shows a waiting agent in the window title until it is answered', { timeout: TEST_TIMEOUT_MS }, async ({ app }) => {
    await waitForTabby(app!)
    await openTerminal(app!)
    await runInTerminal(app!, `DEMO_AGENT_STEP_SECONDS=0.3 '${DEMO_AGENT}'`)
    await expect(app!).toHaveTitle(/\(1 waiting\)/, { timeout: STEP_TIMEOUT_MS })

    await runInTerminal(app!, '1')
    await expect(app!).not.toHaveTitle(/waiting/, { timeout: STEP_TIMEOUT_MS })
})
