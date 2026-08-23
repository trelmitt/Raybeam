import { describe, expect, it } from 'vitest'
import {
  bareHandle,
  judgeXProof,
  parseProofPostId,
  proofPostText,
  verifyXProof,
  xOembedUrl,
  xProofUrl,
} from './x-proof'

const ADDR = '0x1234567890abcdef1234567890ABCDEF12345678'
const oembed = (author: string, text: string) => ({
  author_name: author,
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${text}</p>&mdash; x (@${author}) <a href="https://x.com/${author}/status/20">March 21, 2006</a></blockquote>`,
})

describe('parseProofPostId', () => {
  it('takes a bare id', () => {
    expect(parseProofPostId('1445078208190291973')).toBe('1445078208190291973')
  })
  it('takes the URL people actually paste, on either host', () => {
    expect(parseProofPostId('https://x.com/jack/status/20')).toBe('20')
    expect(parseProofPostId('https://twitter.com/jack/status/20')).toBe('20')
    expect(parseProofPostId('https://mobile.twitter.com/jack/statuses/20')).toBe('20')
    expect(parseProofPostId('https://x.com/jack/status/20?s=46&t=abc')).toBe('20')
  })
  it('returns null for anything without a status id', () => {
    expect(parseProofPostId('https://x.com/jack')).toBeNull()
    expect(parseProofPostId('')).toBeNull()
    expect(parseProofPostId(null)).toBeNull()
    expect(parseProofPostId('not an id')).toBeNull()
  })
  // The whole point of returning an id rather than a url.
  it('never returns anything but digits, whatever it is fed', () => {
    for (const evil of [
      'https://x.com@evil.com/jack/status/20',
      'javascript:alert(1)//status/20',
      '20; DROP TABLE',
      '<script>/status/20</script>',
    ]) {
      const got = parseProofPostId(evil)
      if (got !== null) expect(got).toMatch(/^[0-9]+$/)
    }
  })
})

describe('xProofUrl — the destination cannot be steered', () => {
  it('builds the canonical link', () => {
    expect(xProofUrl('jack', '20')).toBe('https://x.com/jack/status/20')
    expect(xProofUrl('@jack', '20')).toBe('https://x.com/jack/status/20')
  })
  it('refuses a handle that is not X-shaped, which is what closes the phishing hole', () => {
    // the exact shapes the CreatorFeed audit (M5) found
    expect(xProofUrl('x.com@evil.com', '20')).toBeNull()
    expect(xProofUrl('jack/../evil', '20')).toBeNull()
    expect(xProofUrl('evil.com', '20')).toBeNull()
    expect(xProofUrl('a:b', '20')).toBeNull()
    expect(xProofUrl('sixteencharacter', '20')).toBeNull() // 16 > X's 15
  })
  it('refuses a non-numeric post id', () => {
    expect(xProofUrl('jack', '20a')).toBeNull()
    expect(xProofUrl('jack', '../evil')).toBeNull()
    expect(xProofUrl('jack', '')).toBeNull()
  })
  it('points the oembed call at that same canonical url, encoded', () => {
    const u = xOembedUrl('jack', '20')
    expect(u).toContain('publish.x.com/oembed')
    expect(u).toContain(encodeURIComponent('https://x.com/jack/status/20'))
  })
})

describe('judgeXProof — both halves must hold', () => {
  it('verifies when the author matches and the post names the address', () => {
    const r = judgeXProof(oembed('basketchef', proofPostText(ADDR)), { handle: 'basketchef', address: ADDR })
    expect(r.ok).toBe(true)
    expect(r.reason).toBe('verified')
  })
  it('matches the handle case-insensitively', () => {
    expect(judgeXProof(oembed('BasketChef', proofPostText(ADDR)), { handle: 'basketchef', address: ADDR }).ok).toBe(true)
  })
  it('matches the address whatever its checksum casing', () => {
    expect(judgeXProof(oembed('basketchef', `mine: ${ADDR.toLowerCase()}`), { handle: 'basketchef', address: ADDR }).ok).toBe(true)
    expect(judgeXProof(oembed('basketchef', `mine: ${ADDR.toUpperCase().replace('0X', '0x')}`), { handle: 'basketchef', address: ADDR }).ok).toBe(true)
  })

  // THE ATTACK the unsigned proof field has to survive: swap in a post from an
  // account you DO control that names the victim's address. It fails because
  // the author is checked against the handle the victim SIGNED.
  it('refuses a post from a different account, even when it names the address', () => {
    const r = judgeXProof(oembed('attacker', proofPostText(ADDR)), { handle: 'basketchef', address: ADDR })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('wrong-author')
  })
  it('refuses the right account posting somebody else s address', () => {
    const r = judgeXProof(oembed('basketchef', 'gm'), { handle: 'basketchef', address: ADDR })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('address-absent')
  })
  it('fails closed on a missing or shapeless payload', () => {
    expect(judgeXProof(null, { handle: 'basketchef', address: ADDR }).ok).toBe(false)
    expect(judgeXProof({}, { handle: 'basketchef', address: ADDR }).ok).toBe(false)
    expect(judgeXProof({ author_name: 5, html: 7 }, { handle: 'basketchef', address: ADDR }).ok).toBe(false)
  })
  it('refuses an empty claim rather than matching everything', () => {
    expect(judgeXProof(oembed('basketchef', 'gm'), { handle: '', address: ADDR }).ok).toBe(false)
    expect(judgeXProof(oembed('basketchef', 'gm'), { handle: 'basketchef', address: '' }).ok).toBe(false)
  })
})

describe('verifyXProof — every error path reads as not-verified', () => {
  const okRes = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

  it('verifies through the fetch path', async () => {
    const r = await verifyXProof(
      { handle: '@basketchef', postId: '20', address: ADDR },
      { fetchImpl: async () => okRes(oembed('basketchef', proofPostText(ADDR))) },
    )
    expect(r.ok).toBe(true)
  })
  it('treats a non-OK status as a missing post, not as verified', async () => {
    const r = await verifyXProof(
      { handle: 'basketchef', postId: '20', address: ADDR },
      { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) as unknown as Response },
    )
    expect(r).toMatchObject({ ok: false, reason: 'post-missing' })
  })
  it('treats a throwing fetch as unreachable, and never rethrows', async () => {
    const r = await verifyXProof(
      { handle: 'basketchef', postId: '20', address: ADDR },
      { fetchImpl: async () => { throw new Error('offline') } },
    )
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' })
  })
  it('rejects a bad handle or id before making any call', async () => {
    let called = 0
    const spy = (async () => { called++; return okRes({}) }) as unknown as typeof fetch
    expect(await verifyXProof({ handle: 'evil.com', postId: '20', address: ADDR }, { fetchImpl: spy })).toMatchObject({ reason: 'bad-handle' })
    expect(await verifyXProof({ handle: 'jack', postId: 'abc', address: ADDR }, { fetchImpl: spy })).toMatchObject({ reason: 'bad-post-id' })
    expect(called).toBe(0)
  })
})

describe('bareHandle', () => {
  it('strips leading @ and space', () => {
    expect(bareHandle('  @jack ')).toBe('jack')
    expect(bareHandle('@@jack')).toBe('jack')
    expect(bareHandle(null)).toBe('')
  })
})

describe('proofPostText', () => {
  it('names the address, which is the half the account owner must write', () => {
    expect(proofPostText(ADDR)).toContain(ADDR)
  })
})

describe('the handle-phrase binding (owner 2026-08-23: no full wallet in the post)', () => {
  const page = 'https://example.com/creator/iroradev'

  it('the handle template carries the phrase, the page link and NO full address', () => {
    const t = proofPostText(ADDR, { kitHandle: 'iroradev', pageUrl: page })
    expect(t).toContain('I am iroradev on Spectrum')
    expect(t).toContain(page)
    expect(t).not.toContain(ADDR)
    expect(t).toContain('0x1234') // the short form, decoration only
  })
  it('without a kit handle the full address stays the binding', () => {
    expect(proofPostText(ADDR)).toContain(ADDR)
  })

  it('verifies by phrase when the registry-resolved handle matches', () => {
    const r = judgeXProof(oembed('basketchef', 'I am iroradev on Spectrum — one coin, my picks, onchain.'), {
      handle: 'basketchef',
      address: ADDR,
      kitHandle: 'iroradev',
    })
    expect(r).toMatchObject({ ok: true, reason: 'verified' })
  })
  it('matches the phrase case-insensitively', () => {
    expect(judgeXProof(oembed('basketchef', 'i am IroraDev on spectrum'), { handle: 'basketchef', address: ADDR, kitHandle: 'iroradev' }).ok).toBe(true)
  })

  // THE ATTACK the phrase must survive: the attacker signs a profile claiming
  // the victim's X handle and points at the victim's real post. The post says
  // the VICTIM's kit name; the attacker's registry-resolved name differs.
  it("refuses when the post names someone else's kit handle", () => {
    const r = judgeXProof(oembed('basketchef', 'I am iroradev on Spectrum'), {
      handle: 'basketchef',
      address: ADDR,
      kitHandle: 'attackername',
    })
    expect(r.ok).toBe(false)
  })
  // The incidental-word attack: claim the kit name "spectrum" and hope any
  // victim post contains it. The exact phrase makes that require
  // "am spectrum on spectrum", which no template ever writes.
  it('an ordinary mention of Spectrum can never satisfy the phrase', () => {
    const r = judgeXProof(oembed('basketchef', 'I love building on Spectrum'), {
      handle: 'basketchef',
      address: ADDR,
      kitHandle: 'spectrum',
    })
    expect(r.ok).toBe(false)
  })
  it('a null kitHandle never widens acceptance', () => {
    expect(judgeXProof(oembed('basketchef', 'I am  on Spectrum'), { handle: 'basketchef', address: ADDR, kitHandle: null }).ok).toBe(false)
    expect(judgeXProof(oembed('basketchef', 'I am  on Spectrum'), { handle: 'basketchef', address: ADDR, kitHandle: '' }).ok).toBe(false)
  })
  it('the author gate still comes first, phrase or not', () => {
    const r = judgeXProof(oembed('attacker', 'I am iroradev on Spectrum'), { handle: 'basketchef', address: ADDR, kitHandle: 'iroradev' })
    expect(r).toMatchObject({ ok: false, reason: 'wrong-author' })
  })
})

