import { describe, expect, it } from 'vitest'
// Read as TEXT (the redirects-coverage test's own trick) rather than through
// node:fs, which this tsconfig has no types for.
import SCRIPT from '../../../scripts/build-creator-proofs.mjs?raw'
import { judgeXProof, xProofUrl } from './x-proof'

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILD SCRIPT CANNOT IMPORT THIS MODULE (it is a plain .mjs run by node
// before the TS is built), so the proof rules exist in two places. That is a
// drift risk with a security edge: if the script's handle grammar loosened
// while this one stayed strict, the badge would be granted under rules nobody
// reviewed.
//
// This test reads the script as TEXT and pins the three things that must never
// diverge. It cannot execute the script's logic, so it checks the SOURCE OF
// the rules rather than their behaviour — which is exactly the drift that
// would otherwise be invisible.
// ─────────────────────────────────────────────────────────────────────────────

describe('x-proof parity: the app and the build script judge by the same rules', () => {
  it('shares the handle grammar', () => {
    expect(SCRIPT).toContain('/^[A-Za-z0-9_]{1,15}$/')
  })
  it('shares the post-id grammar', () => {
    expect(SCRIPT).toContain('/^[0-9]{1,25}$/')
  })
  it('builds the destination from literals, never from stored text', () => {
    expect(SCRIPT).toContain('`https://x.com/${h}/status/${id}`')
    expect(xProofUrl('jack', '20')).toBe('https://x.com/jack/status/20')
  })
  it('checks BOTH halves — author identity and the address in the body', () => {
    expect(SCRIPT).toContain("reason: 'wrong-author'")
    expect(SCRIPT).toContain("reason: 'address-absent'")
    // and the app agrees on both
    expect(judgeXProof({ author_name: 'other', html: 'x' }, { handle: 'jack', address: '0xabc' }).reason).toBe('wrong-author')
    expect(judgeXProof({ author_name: 'jack', html: 'x' }, { handle: 'jack', address: '0xabc' }).reason).toBe('address-absent')
  })
  it('compares the author case-insensitively on both sides', () => {
    expect(SCRIPT).toContain('.toLowerCase()')
    expect(judgeXProof({ author_name: 'JACK', html: '0xabc' }, { handle: 'jack', address: '0xABC' }).ok).toBe(true)
  })
  // ⚠ This started as a blanket "no credential anywhere" grep and CAUGHT the
  // commit that taught the script to read an Alchemy key for its RPC. That is
  // a legitimate build-time env read, not a shipped secret — so the assertion
  // is rewritten TIGHTER rather than relaxed, to the two things that actually
  // matter: the X call is keyless, and no secret is ever hardcoded.
  it('sends no credential to X — the check itself is what stays keyless', () => {
    const at = SCRIPT.indexOf('publish.x.com/oembed')
    expect(at).toBeGreaterThan(-1)
    const call = SCRIPT.slice(at, at + 400)
    expect(call).not.toMatch(/authorization|bearer|api[_-]?key|oauth|access[_-]?token/i)
    // the only header it may send
    expect(SCRIPT).toContain("headers: { accept: 'application/json' }")
  })
  it('hardcodes no secret — a key may be READ from the environment, never embedded', () => {
    expect(SCRIPT).not.toMatch(/(?:key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i)
    // and any key it does use comes from process.env
    if (/ALCHEMY/i.test(SCRIPT)) expect(SCRIPT).toMatch(/process\.env\.\w*ALCHEMY\w*/)
  })

  it('the phrase binding is byte-identical on both sides', () => {
    // the app builds it...
    expect(SCRIPT).toContain('i am ${kit} on spectrum')
    // ...and both accept full address FIRST, phrase second, nothing third
    const at = SCRIPT.indexOf('function judge(')
    const body = SCRIPT.slice(at, at + 900)
    expect(body).toContain('lower.includes(addr)')
    expect(body).toContain('on spectrum')
  })
  it('the script resolves kit handles conservatively - contested names refuse the phrase', () => {
    expect(SCRIPT).toContain('=== 1) out.set(author, name)')
    expect(SCRIPT).toMatch(/UNDER-grant/i)
  })

  it('writes the flag to a BUILD artifact, never back into creator data', () => {
    expect(SCRIPT).toContain('src/generated/creator-proofs.json')
  })

  // ⚠ THE RULE THAT COST A REWRITE: an outage is not an answer. X being
  // unreachable once emptied the whole set and reported it as a mass
  // revocation — every badge on the site stripped because X had a bad minute.
  // Only a definitive negative may revoke, so these two behaviours are pinned.
  it('carries a verification forward when X could not be ASKED', () => {
    expect(SCRIPT).toContain("r.reason === 'unreachable'")
    expect(SCRIPT).toContain('verified[key] = prevVerified[key]')
  })
  it('refuses to write at all when X was unreachable for every claim', () => {
    expect(SCRIPT).toContain('couldNotAsk === claims.length')
  })
  it('fails the daily check ONLY on a definitive revocation', () => {
    expect(SCRIPT).toContain('revoked.length > 0')
    // a moved set that revokes nothing must exit clean, or the canary cries wolf
    expect(SCRIPT).toMatch(/no revocation[\s\S]{0,80}process\.exit\(0\)/)
  })
})
