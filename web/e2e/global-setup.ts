import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { API_URL, E2E_DATABASE_URL, E2E_DB_NAME, MAILPIT_URL } from './env.ts'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const BACKEND = path.join(REPO_ROOT, 'backend')

function run(cmd: string, args: string[], options: ExecFileSyncOptions = {}) {
  try {
    return execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'], ...options })
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message: string }
    const detail = [err.stderr?.toString(), err.stdout?.toString()].filter(Boolean).join('\n').trim()
    throw new Error(`e2e setup: \`${cmd} ${args.join(' ')}\` failed.\n${detail || err.message}`, { cause: e })
  }
}

/** psql / dropdb / createdb run inside the Postgres container, like the Makefile does. */
const inPostgres = (args: string[], options: ExecFileSyncOptions = {}) =>
  run('docker', ['compose', 'exec', '-T', 'postgres', ...args], options)

function assertServicesUp() {
  try {
    execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'budget', '-d', 'postgres'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
  } catch {
    throw new Error('e2e setup: Docker or the Postgres container isn’t running. Start them with `make db-up`, then run `make e2e` again.')
  }
}

async function assertMailpitUp() {
  try {
    const res = await fetch(`${MAILPIT_URL}/api/v1/info`)
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    throw new Error(`e2e setup: Mailpit isn’t answering on ${MAILPIT_URL}. Start it with \`make db-up\`.`)
  }
}

/**
 * Waits until the e2e API answers /health with 200 (it reaches the freshly migrated DB).
 * Playwright starts the webServers before globalSetup, so the API comes up first (its pool
 * connects lazily) and only turns healthy once this setup has created the database.
 */
async function waitForHealthyApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/health`)
      if (res.ok) return
      last = `${res.status} ${await res.text()}`
    } catch (e) {
      last = String(e)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`e2e setup: the API on ${API_URL} never became healthy (last answer: ${last}).`)
}

/**
 * (Re)creates `budget_tracker_e2e`, migrates it and loads both demo accounts, so every run
 * starts from the same data: dev_seed.sql (`demo`) and cmd/seed -offline (`admin-test`).
 */
export default async function globalSetup() {
  assertServicesUp()
  await assertMailpitUp()

  inPostgres(['dropdb', '-U', 'budget', '--if-exists', '--force', E2E_DB_NAME])
  inPostgres(['createdb', '-U', 'budget', E2E_DB_NAME])

  run('go', ['tool', '-modfile=tools.mod', 'goose', '-dir', 'db/migrations', 'postgres', E2E_DATABASE_URL, 'up'], {
    cwd: BACKEND,
  })

  inPostgres(['psql', E2E_DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync(path.join(BACKEND, 'db/seed/dev_seed.sql')),
  })
  run('go', ['run', './cmd/seed', '-offline'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, APP_ENV: 'development' },
  })

  await waitForHealthyApi()
}
