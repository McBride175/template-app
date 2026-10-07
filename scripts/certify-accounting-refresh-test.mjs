import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const project = 'rbmxegyiwntomhpbepnu'
if (process.argv.length !== 3 || process.argv[2] !== '--execute') throw new Error('Use --execute for the authorized rollback-only Test certification')
if (readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim() !== project) throw new Error('Refusing non-Test project link')
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${project}.supabase.co`) throw new Error('Refusing non-Test application environment')
const connection = new URL(readFileSync(new URL('../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim())
if (connection.username !== `postgres.${project}` || connection.pathname !== '/postgres') throw new Error('Refusing non-Test database identity')
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Test database password unavailable')
const env = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGUSER: connection.username,
  PGDATABASE: 'postgres', PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require', PGAPPNAME: 'yuohme-phase-7-1-certification' }
const sql = readFileSync(new URL('../tests/database/accounting-refresh-hosted-certification.sql', import.meta.url), 'utf8')
const options = { env, input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
let result
try {
  result = execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At'], options).trim()
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  // Use the installed local database's client only. Password travels through
  // stdin, never Docker arguments, logs, files or the image configuration.
  if (/[\r\n]/.test(process.env.SUPABASE_DB_PASSWORD)) throw new Error('Multiline database password requires native psql')
  const environment = ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSSLMODE', 'PGAPPNAME'].flatMap(name => ['-e', `${name}=${env[name]}`])
  result = execFileSync('docker', ['exec', '-i', ...environment, 'supabase_db_template-app', 'sh', '-c',
    'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -q -v ON_ERROR_STOP=1 -At'],
  { ...options, input: `${process.env.SUPABASE_DB_PASSWORD}\n${sql}` }).trim()
}
if (result !== 'phase_7_1_hosted_control_certified_rollback_only') throw new Error('Test certification was not confirmed')
console.log(JSON.stringify({ project, result, businessTablesFingerprinted: 31, fixtureWritesRolledBack: true }))
