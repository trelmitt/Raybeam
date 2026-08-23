// Pure helpers for per-URL OpenGraph/Twitter meta, shared by the Netlify edge
// middleware (../../netlify/edge-functions/og.ts) and its unit test. Social
// crawlers don't run JS, so an SPA can only ever show them the ONE generic card
// baked into index.html; the edge function rewrites those tags per shared URL.
//
// Pure string ops — NO Netlify/Deno/DOM APIs — so this is unit-tested in the
// app's vitest even though the edge function runs on Deno at the edge.
//
// Card COPY carries no numbers (§9): crawlers cache previews for days and a stale
// NAV/perf figure would mislead. og:image points at the branded generic card for
// now; per-basket card IMAGES are a follow-up (see netlify/edge-functions/README).

import { showSymbol } from '../spectrum/safe-copy.ts'

export interface OgMeta {
  title: string
  description: string
  image: string
  url: string
  imageAlt: string
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Swap the content="" of a `<meta property|name="key" content="…">` tag, matching
 *  index.html's exact attribute order (key then content). */
function setContent(html: string, keyAttr: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${keyAttr}\\s+content=")[^"]*(")`, 'i')
  return html.replace(re, `$1${escAttr(value)}$2`)
}

/** Rewrite the static index.html's <title> + og/twitter tags for one URL. Any tag
 *  not present is left untouched (the replace simply no-ops). */
export function rewriteOgHtml(html: string, m: OgMeta): string {
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${escText(m.title)}</title>`)
  out = setContent(out, 'name="description"', m.description)
  out = setContent(out, 'property="og:title"', m.title)
  out = setContent(out, 'property="og:description"', m.description)
  out = setContent(out, 'property="og:url"', m.url)
  out = setContent(out, 'property="og:image"', m.image)
  out = setContent(out, 'property="og:image:alt"', m.imageAlt)
  out = setContent(out, 'name="twitter:title"', m.title)
  out = setContent(out, 'name="twitter:description"', m.description)
  out = setContent(out, 'name="twitter:image"', m.image)
  return out
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// og:image is now the basket's OWN card when one was rendered at build
// (scripts/build-og-cards.mjs writes public/og/<chain>/<addr>.png), falling back
// to the branded generic card. `hasCard` is supplied by the caller, which is the
// only place that can cheaply know whether the file exists — a basket launched
// AFTER the last build has no card, and a stale-but-branded picture beats a
// broken image in someone's feed.
export function basketMeta(
  t: { symbol: string; name: string },
  chain: number,
  addr: string,
  origin: string,
  hasCard = false,
): OgMeta {
  return {
    title: `$${showSymbol(t.symbol)} · ${t.name} · Spectrum`,
    description: `${t.name}, an onchain basket token on Spectrum. One token, a whole basket of assets.`,
    image: hasCard ? `${origin}/og/${chain}/${addr.toLowerCase()}.png` : `${origin}/og.png`,
    url: `${origin}/token?addr=${addr}&chain=${chain}`,
    imageAlt: `${t.name} on Spectrum`,
  }
}

// A CREATOR'S OWN LINK HAS TO CARRY THEIR NAME (owner 2026-08-21). The claim
// ceremony hands a new creator `${origin}/creator/<name>` and a Share-on-X
// button for it, and that was the ONE form this never matched: the edge only
// recognised the 40-hex address form, so the link we actively tell people to
// post previewed as the generic site card, with the generic site title.
//
// The fix needs no lookup, which is the whole reason it is cheap: when the URL
// carries a claimed name, the NAME IS THE LABEL, sitting right there in the
// path. Only the address form has to fall back to a truncated hex.
//
// Still no numbers in card copy (§9): crawlers cache previews for days, and a
// stale holder count or value figure would be a misleading claim.
export function creatorMeta(idOrHandle: string, origin: string, hasCard = false): OgMeta {
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(idOrHandle)
  // handles are stored lowercase and rendered with the @ the site shows
  const label = isAddress ? short(idOrHandle) : `@${idOrHandle.toLowerCase()}`
  const key = isAddress ? idOrHandle.toLowerCase() : idOrHandle.toLowerCase()
  return {
    title: `${label} · Spectrum creator`,
    description: isAddress
      ? `Onchain basket tokens created by ${label} on Spectrum. One token, a whole basket of assets.`
      : `Every basket ${label} makes, on one page. Onchain basket tokens on Spectrum: one token, a whole basket of assets.`,
    image: hasCard ? `${origin}/og/creator/${key}.png` : `${origin}/og.png`,
    url: `${origin}/creator/${idOrHandle}`,
    imageAlt: `${label}, a creator on Spectrum`,
  }
}

export function referMeta(origin: string): OgMeta {
  return {
    title: 'Refer & earn · Spectrum',
    description: 'Share Spectrum and earn a slice of the protocol fee, onchain in USDC, on every trade and launch through your link. No signup.',
    image: `${origin}/og.png`,
    url: `${origin}/earn`,
    imageAlt: 'Refer & earn on Spectrum',
  }
}
