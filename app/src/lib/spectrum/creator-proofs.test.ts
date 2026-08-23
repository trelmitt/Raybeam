import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module reads the generated artifact at import scope, so the fixture has
// to be in place before it loads.
vi.mock('../../generated/creator-proofs.json', () => ({
  default: {
    v: 1,
    checkedAt: '2026-08-22',
    verified: {
      '8453:0x1111111111111111111111111111111111111111': { handle: 'basketchef', postId: '20' },
      '1:0x2222222222222222222222222222222222222222': { handle: 'MixedCase', postId: '21' },
    },
  },
}))

const { xStandingFor, proofsCheckedAt } = await import('./creator-proofs')

const VERIFIED = '0x1111111111111111111111111111111111111111'
const OTHER = '0x9999999999999999999999999999999999999999'

describe('xStandingFor — what this build may honestly claim', () => {
  beforeEach(() => vi.clearAllMocks())

  it('says nothing at all without a handle', () => {
    expect(xStandingFor(8453, VERIFIED, null).kind).toBe('none')
    expect(xStandingFor(8453, VERIFIED, '   ').kind).toBe('none')
  })

  it('verifies a creator the build checked, and hands over the proof link', () => {
    const s = xStandingFor(8453, VERIFIED, '@basketchef')
    expect(s.kind).toBe('verified')
    expect(s.handle).toBe('basketchef')
    expect(s.proofUrl).toBe('https://x.com/basketchef/status/20')
    expect(s.checkedAt).toBe('2026-08-22')
  })

  // The default, and where every creator sits until they post a proof.
  it('is a CLAIM, not a verification, when the build has no entry', () => {
    const s = xStandingFor(8453, OTHER, '@somebody')
    expect(s.kind).toBe('claimed')
    expect(s.proofUrl).toBeNull()
    expect(s.checkedAt).toBeNull()
    // it still links to their X — linking was never the thing in question
    expect(s.profileUrl).toBe('https://x.com/somebody')
  })

  // ⚠ THE RULE WITH TEETH. A verified entry is bound to the handle that was
  // checked. Rename afterwards and the badge must NOT travel to the new
  // handle, because nobody has looked at that one.
  it('drops back to a claim when the creator renamed after the check', () => {
    const s = xStandingFor(8453, VERIFIED, '@someoneelse')
    expect(s.kind).toBe('claimed')
    expect(s.proofUrl).toBeNull()
  })

  // The key is chain-scoped: the proof was read from ONE chain's registry.
  it('does not carry a verification across chains', () => {
    expect(xStandingFor(1, VERIFIED, '@basketchef').kind).toBe('claimed')
    expect(xStandingFor(8453, VERIFIED, '@basketchef').kind).toBe('verified')
  })

  it('matches the address whatever its checksum casing', () => {
    expect(xStandingFor(8453, VERIFIED.toUpperCase().replace('0X', '0x'), '@basketchef').kind).toBe('verified')
  })

  it('matches the handle case-insensitively, as X does', () => {
    expect(xStandingFor(1, '0x2222222222222222222222222222222222222222', '@mixedcase').kind).toBe('verified')
  })

  it('cannot verify without an address to key on', () => {
    expect(xStandingFor(8453, null, '@basketchef').kind).toBe('claimed')
  })

  it('reports when the site last re-checked', () => {
    expect(proofsCheckedAt()).toBe('2026-08-22')
  })
})
