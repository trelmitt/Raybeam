// ─────────────────────────────────────────────────────────────────────────────
// X PROOF — turning a claimed handle into a checked one.
//
// A signed profile proves the WALLET: the signature recovers to the on-chain
// deployer, so we know the person who typed "@basketchef" controls the deploy
// wallet. It says nothing about whether they control @basketchef, which is why
// `xUrlForHandle` forbids callers from labelling a handle "verified".
//
// The missing half is a LINK-BACK, and it needs no key, no database and no
// backend. The creator posts their creator ADDRESS publicly from the account.
// That gives a proof in both directions:
//
//   the profile says  "my X is @basketchef"   ← only the wallet owner writes this
//   the post says     "my address is 0x…"     ← only the account owner writes this
//
// Nobody produces both halves without controlling both. Same shape as ENS or
// Keybase-style proofs.
//
// ⚠ THE CREATOR NEVER SUPPLIES A URL, ONLY A POST ID. A free-text destination
// under a "posted by the creator" heading is the exact phishing surface the
// audit found (CreatorFeed M5: `https://x.com@evil.com/` renders as
// "x.com@evil.com"). Here the host AND the handle are literals and the id is
// digits-only, so no typed value can steer where anything points.
//
// ⚠ WHY THE PROOF ID DOES NOT NEED TO BE SIGNED. It rides outside the EIP-712
// struct (like `delegate` already does — DOMAIN_VERSION is fixed at '1', so
// adding a field would invalidate every signature ever issued). It is safe
// unsigned because the check binds to the SIGNED handle: `author_name` must
// equal the handle the creator signed, and the post must name their address.
// Tampering with the id can therefore only REMOVE a verification, never forge
// one — an attacker would need a post from the victim's own account.
//
// ⚠ THE VERIFIED FLAG IS NEVER CREATOR-CONTROLLED. Creators supply a proof;
// the BUILD decides (scripts/build-creator-proofs.mjs). Nothing a creator can
// write makes their own badge say verified.
// ─────────────────────────────────────────────────────────────────────────────

/** X's own handle grammar. The single authority, shared with xUrlForHandle. */
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/

/** Snowflake ids are ~19 digits; cap generously and allow nothing but digits. */
const POST_ID_RE = /^[0-9]{1,25}$/

export interface XProofClaim {
  /** The handle the creator SIGNED, without the leading '@'. */
  handle: string
  /** Digits-only post id. */
  postId: string
}

export type XProofFailure =
  | 'no-claim'
  | 'bad-handle'
  | 'bad-post-id'
  | 'unreachable'
  | 'post-missing'
  | 'wrong-author'
  | 'address-absent'

export interface XProofResult {
  ok: boolean
  reason: XProofFailure | 'verified'
  /** The author the post actually belongs to, when we learned it. */
  author?: string | null
}

/** Strip any leading '@' and surrounding space. Does not validate. */
export function bareHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '')
}

/**
 * Accept what a creator is likely to paste — a full post URL, or a bare id —
 * and return the digits-only id, or null.
 *
 * Deliberately permissive about the HOST it will read an id out of (people
 * paste twitter.com, x.com, mobile.twitter.com, with or without query junk)
 * and absolutely strict about what it RETURNS: digits only, which is the whole
 * reason a pasted string can never steer a destination later.
 */
export function parseProofPostId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (POST_ID_RE.test(raw)) return raw
  const m = raw.match(/(?:^|[/])status(?:es)?[/]([0-9]{1,25})(?:[/?#]|$)/)
  return m?.[1] ?? null
}

/** The canonical public link to the proof. Host + handle are literals here. */
export function xProofUrl(handle: string | null | undefined, postId: string | null | undefined): string | null {
  const h = bareHandle(handle)
  const id = (postId ?? '').trim()
  if (!HANDLE_RE.test(h) || !POST_ID_RE.test(id)) return null
  return `https://x.com/${h}/status/${id}`
}

/**
 * The keyless check endpoint. X's oEmbed needs no API key, no account and no
 * auth, and answers with the post's CURRENT author plus its text — which is
 * exactly the two facts a proof needs. Verified live 2026-08-22: 200 JSON with
 * `author_name`, and an `access-control-allow-origin` that echoes the caller.
 *
 * ⚠ It resolves by POST ID and reports the author as of NOW, which is the
 * property that makes re-checking meaningful: a sold or renamed handle stops
 * matching on its own.
 */
export function xOembedUrl(handle: string, postId: string): string | null {
  const target = xProofUrl(handle, postId)
  if (!target) return null
  return `https://publish.x.com/oembed?url=${encodeURIComponent(target)}&omit_script=1&dnt=true`
}

/** The shape we read out of oEmbed. Everything optional: it is a foreign API. */
export interface XOembedPayload {
  author_name?: unknown
  html?: unknown
}

/**
 * THE DECISION, as a pure function — no network, so it is testable against
 * exact payloads rather than against whatever X happened to return today.
 *
 * Both halves must hold:
 *   1. the post's author IS the signed handle (case-insensitive; X handles are
 *      not case-sensitive, and oEmbed echoes the account's display casing),
 *   2. the post NAMES the creator's address (case-insensitive: a pasted address
 *      may be checksummed or lowercased, and the post is plain text).
 */
export function judgeXProof(
  payload: XOembedPayload | null,
  claim: { handle: string; address: string; kitHandle?: string | null },
): XProofResult {
  if (!payload) return { ok: false, reason: 'post-missing' }
  const author = typeof payload.author_name === 'string' ? payload.author_name : null
  const html = typeof payload.html === 'string' ? payload.html : ''
  const want = bareHandle(claim.handle).toLowerCase()
  if (!want) return { ok: false, reason: 'bad-handle' }
  if (!author || author.trim().toLowerCase() !== want) {
    return { ok: false, reason: 'wrong-author', author }
  }
  const lower = html.toLowerCase()
  const addr = (claim.address ?? '').trim().toLowerCase()
  // An address is 42 hex chars with nothing HTML-escapable in it, so it
  // survives oEmbed's escaping intact and a plain scan is exact.
  if (addr && lower.includes(addr)) return { ok: true, reason: 'verified', author }
  // The handle binding (owner 2026-08-23: the post should not dox the wallet).
  // `kitHandle` is NEVER creator-typed data: the caller resolves it from the
  // handle registry for THIS address, so matching the phrase binds
  // account → name → address with the registry as the middle link. An attacker
  // pointing their profile at someone else's post fails here because the
  // victim's post carries the victim's name, not the attacker's.
  const kit = (claim.kitHandle ?? '').trim().toLowerCase()
  if (kit && lower.includes(xProofPhrase(kit).toLowerCase())) {
    return { ok: true, reason: 'verified', author }
  }
  return { ok: false, reason: 'address-absent', author }
}

/**
 * Fetch + judge. FAILS CLOSED on every error path: an unreachable X, a rate
 * limit, a deleted post and a network blip all read as "not verified", never
 * as verified and never as a thrown error reaching a caller.
 *
 * `fetchImpl` is injectable so the build script, the tests and the browser all
 * drive the same logic.
 */
export async function verifyXProof(
  claim: { handle: string; postId: string; address: string; kitHandle?: string | null },
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<XProofResult> {
  const h = bareHandle(claim.handle)
  if (!HANDLE_RE.test(h)) return { ok: false, reason: 'bad-handle' }
  if (!POST_ID_RE.test((claim.postId ?? '').trim())) return { ok: false, reason: 'bad-post-id' }
  const url = xOembedUrl(h, claim.postId.trim())
  if (!url) return { ok: false, reason: 'bad-post-id' }

  const doFetch = opts.fetchImpl ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await doFetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    // A deleted or protected post answers 404 with an HTML error page, so a
    // non-OK status is "the proof does not resolve", not "X is down".
    if (!res.ok) return { ok: false, reason: 'post-missing' }
    const payload = (await res.json()) as XOembedPayload
    return judgeXProof(payload, { handle: h, address: claim.address, kitHandle: claim.kitHandle })
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/** Display-only shortening. NEVER a binding: 6+4 hex is ~40 bits, and vanity
 *  grinders reach that — an attacker could mint an address sharing the victim's
 *  abbreviation and pass a check that matched it. Bindings are the full address
 *  or the registry-resolved kit handle, nothing between. */
export function shortProofAddr(address: string): string {
  const a = (address ?? '').trim()
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/** THE PHRASE THAT BINDS A POST TO A KIT HANDLE. Exact, spaces and all — a
 *  handle is [a-z0-9-] so no choice of handle can smuggle this phrase inside
 *  another creator's natural text (the incidental-word attack: someone claims
 *  the kit name "spectrum" and hopes victims' posts contain it; they contain
 *  "on Spectrum", never "am spectrum on spectrum"). */
export function xProofPhrase(kitHandle: string): string {
  return `I am ${kitHandle} on Spectrum`
}

/** What a creator should post, so the check can pass (owner 2026-08-23: more
 *  interesting, no full wallet, and a link to their page).
 *
 *  With a claimed kit handle the HANDLE is the binding — the handle registry
 *  maps it to their address on-chain, so the post needs no hex at all; the
 *  short address is decoration and the page link is for humans (the check
 *  never reads it: X wraps links in t.co and truncates their display, so a
 *  URL can never be a binding). Without a handle, the full address stays the
 *  binding, exactly as before. */
export function proofPostText(
  address: string,
  opts?: { kitHandle?: string | null; pageUrl?: string | null },
): string {
  const h = (opts?.kitHandle ?? '').trim()
  if (h) {
    const page = (opts?.pageUrl ?? '').trim()
    return `${xProofPhrase(h)}. One coin, my picks, onchain.${page ? `\n${page}` : ''}\nSigned, ${shortProofAddr(address)}`
  }
  return `Verifying my Spectrum creator page: ${address}`
}

/** Human words for a failure, for the editor. Never shown as an accusation. */
export function xProofFailureWords(reason: XProofFailure | 'verified'): string {
  switch (reason) {
    case 'verified':
      return 'Checked: this post is from that account and names your address.'
    case 'wrong-author':
      return 'That post is not from the handle on your profile.'
    case 'address-absent':
      return 'That post does not contain your address. Keep the post short so it is not cut off.'
    case 'post-missing':
      return 'That post does not resolve. It may be deleted, or from a protected account.'
    case 'bad-post-id':
      return 'Paste the link to your post, or its id.'
    case 'bad-handle':
      return 'Add your X handle above first.'
    case 'unreachable':
      return 'Could not reach X to check just now. Your proof is saved; the site re-checks on every build.'
    case 'no-claim':
    default:
      return 'No proof posted yet.'
  }
}
