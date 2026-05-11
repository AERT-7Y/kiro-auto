import { readFile } from 'node:fs/promises'

function unquoteEnvValue(value: string): string {
  const text = value.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1)
    }
  }
  return text
}

export async function loadDotEnvFile(path: string): Promise<void> {
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]!
    if (process.env[key] !== undefined) continue
    process.env[key] = unquoteEnvValue(match[2] ?? '')
  }
}

export function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return ''
}
