// ─────────────────────────────────────────────────────────────────────────────
// CHECK EVERY CREATOR'S X LINK-BACK, AT BUILD TIME (owner 2026-08-22).
//
// A signed profile proves the WALLET. It says nothing about whether the person
// controls the handle they typed. The missing half is a link-back: the creator
// posts their creator ADDRESS from the account, and we check that the post
// really is from that handle and really does name that address. Both halves
// together can only be produced by someone holding both.
//
// ⚠ WHY BUILD TIME AND NOT THE BROWSER. X's oEmbed is keyless AND sends an
// `access-control-allow-origin` that echoes the caller, so a visitor's browser
// COULD make this call. It must not. Doing it at runtime tells X who is
// browsing which creator page, and multiplies an unknown rate limit by site
// traffic. Here it runs once, on the operator's machine, over every creator.
//
// ⚠ NO CREDENTIAL EXISTS ON THIS PATH. oEmbed needs no key, no account and no
// auth, which is what lets EVERY self-hosting operator verify without signing
// up for anything. Nothing here can trip `no-client-secrets.mjs`, because
// there is no secret to leak.
//
// ⚠ VERIFICATION DECAYS, so this is meant to be RE-RUN, not run once. Handles
// get sold and renamed; proof posts get deleted. oEmbed resolves by post id
// and reports the author as of now, so a stale claim stops matching on its
// own. The daily canary workflow re-runs this and the flag drops itself.
//
// Output: `src/generated/creator-proofs.json` — the flag lives in a BUILD
// artifact, never in creator-controlled data, so no creator can self-assert.
//
//   node scripts/build-creator-proofs.mjs            # check + write
//   node scripts/build-creator-proofs.mjs --check    # exit 1 if the file is stale
//   RPC_8453=… RPC_1=… RPC_4663=…                    # override public endpoints
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, getAddress, keccak256, parseAbiItem, stringToHex } from 'viem'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/generated/creator-proofs.json')
const DEPLOYMENTS = JSON.parse(readFileSync(join(ROOT, 'src/lib/chain/deployments.json'), 'utf8'))

const CHECK_ONLY = process.argv.includes('--check')

// MIRRORS src/lib/chain/rpc.ts: Alchemy when a key is present, the public
// endpoint otherwise. This matters more here than for tokenlist, because a
// profile read is `eth_getLogs` over history and the free endpoints refuse it
// outright ("Archive requests require a personal token") at ANY range — so
// without a key, mainnet profiles are unreadable, exactly as they are in the
// browser. The canary already exports CANARY_ALCHEMY_KEY for this reason.
const ALCHEMY = (process.env.ALCHEMY_KEY ?? process.env.VITE_ALCHEMY_API_KEY ?? '').trim()
const RPC = {
  8453: process.env.RPC_8453 ?? (ALCHEMY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY}` : 'https://base-rpc.publicnode.com'),
  1: process.env.RPC_1 ?? (ALCHEMY ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY}` : 'https://ethereum-rpc.publicnode.com'),
  4663: process.env.RPC_4663 ?? (ALCHEMY ? `https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY}` : 'https://rpc.mainnet.chain.robinhood.com'),
}

// ── the proof rules, mirrored from src/lib/spectrum/x-proof.ts ───────────────
// A build script cannot import the app's TS, so the two must agree. The shared
// contract is pinned by src/lib/spectrum/x-proof.parity.test.ts, which reads
// THIS file and fails if either grammar drifts.
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/
const POST_ID_RE = /^[0-9]{1,25}$/

const bareHandle = (h) => String(h ?? '').trim().replace(/^@+/, '')

function xProofUrl(handle, postId) {
  const h = bareHandle(handle)
  const id = String(postId ?? '').trim()
  if (!HANDLE_RE.test(h) || !POST_ID_RE.test(id)) return null
  return `https://x.com/${h}/status/${id}`
}

/** Both halves must hold. Pure, same judgement as judgeXProof(). The phrase
 *  form mirrors xProofPhrase() exactly (pinned by the parity test). */
function judge(payload, handle, address, kitHandle) {
  if (!payload) return { ok: false, reason: 'post-missing' }
  const author = typeof payload.author_name === 'string' ? payload.author_name : null
  const html = typeof payload.html === 'string' ? payload.html : ''
  const want = bareHandle(handle).toLowerCase()
  if (!want) return { ok: false, reason: 'bad-handle' }
  if (!author || author.trim().toLowerCase() !== want) return { ok: false, reason: 'wrong-author', author }
  const lower = html.toLowerCase()
  const addr = String(address ?? '').trim().toLowerCase()
  if (addr && lower.includes(addr)) return { ok: true, reason: 'verified', author }
  const kit = String(kitHandle ?? '').trim().toLowerCase()
  if (kit && lower.includes(`i am ${kit} on spectrum`)) return { ok: true, reason: 'verified', author }
  return { ok: false, reason: 'address-absent', author }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One keyless call, failing CLOSED on every error path. */
async function checkProof(handle, postId, address, kitHandle) {
  const target = xProofUrl(handle, postId)
  if (!target) return { ok: false, reason: 'bad-post-id' }
  const url = `https://publish.x.com/oembed?url=${encodeURIComponent(target)}&omit_script=1&dnt=true`
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, reason: 'post-missing' }
    return judge(await res.json(), handle, address, kitHandle)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

// ── read every on-chain profile that claims a handle + a proof ───────────────

// EXACTLY the signature profile-registry.ts parses — the payload field is
// `note`, not `body`, and a mismatch here reads every profile as empty rather
// than failing, which would silently un-verify everyone.
const noteSetEvent = parseAbiItem(
  'event NoteSet(address indexed author, address indexed subject, bytes32 indexed kind, string note)',
)

/** keccak256("profile") — the profile note kind, as profile-registry computes it. */
const PROFILE_KIND = keccak256(stringToHex('profile'))
/** keccak256("handle") — the kit-name claim kind (handle-registry.ts). */
const HANDLE_KIND = keccak256(stringToHex('handle'))
const HANDLE_AUTHORITY_CHAIN = 8453

/**
 * address → the kit name the PHRASE binding may use, resolved CONSERVATIVELY.
 *
 * The FE's full resolution is earliest-wins among claimants who pass the
 * deployed-somewhere gate (handle-registry.ts). This script does not
 * reimplement that consensus — duplicated consensus drifts, and a drifted
 * grant is a forged badge. Instead: a name is usable for the phrase binding
 * ONLY when exactly one address has EVER claimed it (releases do not un-count;
 * a once-contested name stays contested here). That rule can only UNDER-grant:
 * a contested name falls back to requiring the full address in the post, never
 * to granting the wrong owner. Uncontested names — which is all of them today —
 * verify by phrase.
 */
async function kitHandlesByAddress() {
  const registry = DEPLOYMENTS[String(HANDLE_AUTHORITY_CHAIN)]?.notesRegistry
  if (!registry || !RPC[HANDLE_AUTHORITY_CHAIN]) return new Map()
  const client = createPublicClient({ transport: http(RPC[HANDLE_AUTHORITY_CHAIN]) })
  const logs = await (async () => {
    const head = await client.getBlockNumber({ cacheTime: 0 })
    const clamp = (back) => (head > back ? head - back : 0n)
    let lastErr
    for (const from of [0n, clamp(500_000n), clamp(50_000n)]) {
      try {
        return await client.getLogs({ address: registry, event: noteSetEvent, args: { kind: HANDLE_KIND }, fromBlock: from, toBlock: head })
      } catch (e) { lastErr = e }
    }
    throw lastErr ?? new Error('handle getLogs failed')
  })()
  const latestByAuthor = new Map() // authorLower → nameDisplay ('' = released)
  const everClaimed = new Map() // nameLower → Set(authorLower)
  for (const l of logs) {
    if (!l.args?.author || l.args.author !== l.args.subject) continue
    const author = l.args.author.toLowerCase()
    let name = null
    if (l.args.note === '') name = ''
    else {
      try {
        const j = JSON.parse(l.args.note)
        if (j && j.v === 1 && typeof j.h === 'string') name = j.h
      } catch { /* not a claim */ }
    }
    if (name === null) continue
    latestByAuthor.set(author, name)
    if (name !== '') {
      const key = name.toLowerCase()
      if (!everClaimed.has(key)) everClaimed.set(key, new Set())
      everClaimed.get(key).add(author)
    }
  }
  const out = new Map()
  for (const [author, name] of latestByAuthor) {
    if (!name) continue
    if ((everClaimed.get(name.toLowerCase())?.size ?? 0) === 1) out.set(author, name)
  }
  return out
}

/**
 * THE SAME RETREAT LADDER fetchNotes() uses (profile-registry.ts): ask for the
 * whole history, then fall back to bounded windows. A public RPC refuses
 * fromBlock:0 on Ethereum outright ("Archive requests require a personal
 * token"), so without this the mainnet read is not slow, it is impossible.
 */
async function logsWithRetreat(client, registry) {
  const head = await client.getBlockNumber({ cacheTime: 0 })
  const clamp = (back) => (head > back ? head - back : 0n)
  const windows = [0n, clamp(500_000n), clamp(50_000n)]
  let lastErr
  for (const from of windows) {
    try {
      return await client.getLogs({
        address: registry,
        event: noteSetEvent,
        args: { kind: PROFILE_KIND },
        fromBlock: from,
        toBlock: head,
      })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('getLogs failed with no error reported')
}

async function claimsForChain(chainId, registry) {
  const client = createPublicClient({ transport: http(RPC[chainId]) })
  const logs = await logsWithRetreat(client, registry)
  // Newest note per author wins — the registry is append-only and logs come
  // back oldest-first.
  const latest = new Map()
  for (const l of logs) {
    if (!l.args?.author || l.args.author !== l.args.subject) continue // a profile is about yourself
    latest.set(l.args.author.toLowerCase(), l)
  }
  const out = []
  for (const [addr, log] of latest) {
    let json
    try {
      json = JSON.parse(log.args.note)
    } catch {
      continue
    }
    if (!json || json.v !== 1) continue
    const handle = bareHandle(json.handle)
    const postId = String(json.xProof ?? '').trim()
    if (!HANDLE_RE.test(handle) || !POST_ID_RE.test(postId)) continue
    out.push({ chainId, address: getAddress(addr), handle, postId })
  }
  return out
}

// ── run ──────────────────────────────────────────────────────────────────────

const chains = Object.entries(DEPLOYMENTS)
  .map(([id, cfg]) => ({ chainId: Number(id), registry: cfg?.notesRegistry }))
  .filter((c) => c.registry && RPC[c.chainId])

// Read the existing file FIRST: it is what an unreadable chain falls back to.
const prevRaw = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
let prev = null
try {
  prev = JSON.parse(prevRaw)
} catch {
  /* unreadable = treat as absent */
}
const prevVerified = prev?.verified ?? {}

// ⚠ AN UNREADABLE CHAIN CARRIES FORWARD, IT DOES NOT DROP.
// A flaky RPC, a missing Alchemy key or a rate limit must never silently
// un-verify a creator we simply failed to look at — that would turn an
// infrastructure hiccup into a public accusation. So a chain we could read is
// RECOMPUTED (badges can be granted and revoked), and a chain we could not is
// carried over from the previous run untouched, loudly.
let claims = []
const unreadable = []
for (const c of chains) {
  try {
    claims.push(...(await claimsForChain(c.chainId, c.registry)))
  } catch (e) {
    unreadable.push(c.chainId)
    console.warn(`[creator-proofs] chain ${c.chainId} unreadable, carrying its previous entries forward: ${e.shortMessage ?? e.message}`)
  }
}
if (unreadable.length === chains.length) {
  // Nothing was readable at all: writing now would be pure carry-forward
  // dressed up as a fresh check. Say so and change nothing.
  console.error('[creator-proofs] no chain was readable; leaving the file untouched')
  process.exit(CHECK_ONLY ? 0 : 1)
}

const verified = {}
// carry forward every entry belonging to a chain we could not read
for (const [key, val] of Object.entries(prevVerified)) {
  const chainOf = Number(String(key).split(':')[0])
  if (unreadable.includes(chainOf)) verified[key] = val
}
let ok = 0
let carried = 0
let couldNotAsk = 0
const revoked = []

// ⚠ "COULD NOT ASK" IS NOT "NOT THEIRS" — the same rule as an unreadable
// chain, which this originally failed to apply to X itself. If X is down or
// rate-limits, EVERY check returns `unreachable`; re-adding nothing would have
// emptied the set and stripped every badge on the site because X had a bad
// minute, and reported it as a mass revocation. Only a DEFINITIVE negative
// (wrong author, address absent, post gone) may revoke.
//
// Sequential with a small gap: the endpoint's rate limit is undocumented, and
// a build is not in a hurry.
// Resolved once for the run; unreachable = empty map = address-binding only,
// never a dropped badge (an already-verified phrase claim simply re-verifies
// by phrase next run, and this run carries it via the unreachable path only
// when X itself was unreachable — a missing handle map instead FAILS the
// phrase check closed, which reads as address-absent, a definitive negative).
// ⚠ So: if the handle map is unreadable, do NOT treat phrase-verified entries
// as revoked — carry them, loudly.
let kitHandles = new Map()
let handleMapOk = true
try {
  kitHandles = await kitHandlesByAddress()
} catch (e) {
  handleMapOk = false
  console.warn(`[creator-proofs] handle registry unreadable, phrase bindings carry forward: ${e.shortMessage ?? e.message}`)
}

for (const c of claims) {
  const key = `${c.chainId}:${c.address.toLowerCase()}`
  if (!handleMapOk && prevVerified[key]) {
    // cannot re-judge the phrase without the map; keep what stood
    verified[key] = prevVerified[key]
    carried++
    continue
  }
  const r = await checkProof(c.handle, c.postId, c.address, kitHandles.get(c.address.toLowerCase()) ?? null)
  if (r.ok) {
    ok++
    verified[key] = { handle: c.handle, postId: c.postId }
  } else if (r.reason === 'unreachable') {
    couldNotAsk++
    if (prevVerified[key]) {
      verified[key] = prevVerified[key]
      carried++
    }
  } else {
    // definitive: the post does not prove what the profile claims
    if (prevVerified[key]) revoked.push(`${c.handle} (${c.address}): ${r.reason}`)
    console.log(`[creator-proofs] ${c.handle} (${c.address}) not verified: ${r.reason}`)
  }
  await sleep(350)
}

if (couldNotAsk > 0) {
  console.warn(`[creator-proofs] could not reach X for ${couldNotAsk} claim(s); ${carried} previous verification(s) carried forward untouched`)
}
// X unreachable for EVERY claim is an outage, not an answer. Writing now would
// be pure carry-forward wearing the date of a fresh check.
if (claims.length > 0 && couldNotAsk === claims.length) {
  console.error('[creator-proofs] X was unreachable for every claim; leaving the file untouched')
  process.exit(CHECK_ONLY ? 0 : 1)
}

// checkedAt is a DATE, not a timestamp: it is rendered to readers as "checked
// on", and a to-the-second value would imply a freshness the daily re-check
// does not have.
const next = {
  v: 1,
  checkedAt: new Date().toISOString().slice(0, 10),
  verified,
}

// Compare the SET, not the file: the date changes every run and would make
// --check permanently dirty.
const same = prev && JSON.stringify(prev.verified ?? {}) === JSON.stringify(verified)

if (CHECK_ONLY) {
  // LOUD only on a definitive revocation: a badge on the live site is now
  // false, and the operator has to rebuild for it to drop. Everything else
  // (a new verification to pick up, an outage) is reported and exits clean, so
  // the daily canary does not cry wolf about X's uptime.
  if (revoked.length > 0) {
    console.error(`[creator-proofs] REVOKED — ${revoked.length} live badge(s) no longer check out:`)
    for (const r of revoked) console.error(`  - ${r}`)
    console.error('Rebuild and redeploy to drop them from the site.')
    process.exit(1)
  }
  if (!same) {
    console.log(`[creator-proofs] the set moved (${Object.keys(verified).length} verified now vs ${Object.keys(prevVerified).length} committed) — no revocation, rebuild to pick it up`)
    process.exit(0)
  }
  console.log(`[creator-proofs] up to date (${ok}/${claims.length} claims verified)`)
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
// Keep the previous checkedAt when nothing moved, so a no-op run does not
// churn the file (and the git diff stays meaningful).
writeFileSync(OUT, JSON.stringify(same ? prev : next, null, 2) + '\n')
console.log(`[creator-proofs] ${ok}/${claims.length} claims verified across ${chains.length} chain(s) → src/generated/creator-proofs.json`)
