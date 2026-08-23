// /mcp — the agent surface, sold and documented on one page (owner 2026-08-19:
// "part marketing part documentation on what's possible"). Same register as
// /integrate: a pitch up top for the person deciding, the working reference
// below for the agent-wirer. Every claim here mirrors mcp/README.md in the
// kit; the code snippets are the real interface, kept short on purpose.
// House style: no em dashes on this page.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Callout, CodeBlock, IC, Table } from '../components/DocKit'
import mcpManifest from '../generated/mcp-tools.json'

const GRADIENT = 'linear-gradient(90deg,var(--color-cyan),var(--color-violet-bright),var(--color-magenta))'

const REGISTER = `{
  "mcpServers": {
    "spectrum": { "command": "/path/to/kit/mcp/run.sh" }
  }
}`

const BUILD = `git clone https://github.com/Irora-dev/Spectrum
cd Spectrum/app && npm install && npm run mcp:build
bash ../mcp/run.sh --check   # proves the install: build, handshake, live health
# Claude Code, one line:
claude mcp add spectrum -- /path/to/Spectrum/mcp/run.sh`

const CONVERSATION = `"What baskets are there on Base?"     > the factory's live list
"Read the SVI basket."                > NAV with provenance, legs, weights
"Buy $100 of it."                     > { approval, swap } to sign, floor pre-simulated
"Actually migrate it into TRINITY."   > the sell, then the sequenced buy
"Get me out."                         > redeemInKind calldata, no pool, no floor`

function Pillar({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.18] bg-white/[0.07] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.09)] transition-colors hover:border-white/[0.3]">
      <div className="font-display text-lg font-bold uppercase tracking-tight text-ink">{title}</div>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">{children}</p>
    </div>
  )
}

// ── THE FOUR CLAIMS, DRAWN (owner 2026-08-21: "make this more visual") ───────
// They were four grey slabs of six-line prose, identical in shape, sitting
// four-up in 226px columns — a wall of text where the mechanism was the
// interesting part. Each claim now carries a FIGURE of its own mechanism and
// exactly one line of words, two-up so the figure has room to be legible.
//
// The figures are HTML, not SVG, on purpose: real text stays crisp and the
// theme tokens keep working, which matters more than usual now that light is
// the plane a visitor lands on. Every stroke is currentColor or a brand token —
// a `white/x` hairline would simply vanish on paper. Deliberately four
// DIFFERENT diagram forms (an absent slot, a boundary, a measured track, a
// message), because four variations of one icon row is the thing that reads as
// filler.
const Node = ({ children, tone }: { children: ReactNode; tone?: 'accent' }) => (
  <span
    className={`whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
      tone === 'accent' ? 'border-cyan/45 bg-cyan/10 text-ink' : 'border-ink/20 bg-ink/[0.04] text-ink-dim'
    }`}
  >
    {children}
  </span>
)

/** A flow arrow with its protocol/payload named above the line. */
const Arrow = ({ label }: { label?: string }) => (
  <span className="flex min-w-8 flex-1 flex-col items-center gap-1">
    {label && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>}
    <svg viewBox="0 0 48 8" aria-hidden className="h-2 w-full" preserveAspectRatio="none">
      <line x1="0" y1="4" x2="42" y2="4" stroke="currentColor" strokeWidth="1" className="text-ink/30" />
      <path d="M42 1.5 L47 4 L42 6.5 Z" fill="currentColor" className="text-ink/45" />
    </svg>
  </span>
)

const KeyGlyph = ({ struck }: { struck?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 shrink-0">
    <circle cx="5.5" cy="5.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7.8 7.8 L13 13 M10.5 13 L13 13 L13 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    {struck && <path d="M1.5 14.5 L14.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
  </svg>
)

function Claim({ title, line, figure }: { title: string; line: string; figure: ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink/12 bg-ink/[0.03] p-6 transition-colors hover:border-ink/25">
      {/* the figure leads: it is the argument, the sentence only names it */}
      <div className="flex h-18 items-center">{figure}</div>
      <div className="mt-4 font-display text-lg font-bold uppercase tracking-tight text-ink">{title}</div>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">{line}</p>
    </div>
  )
}

export function Mcp() {
  return (
    <div className="pb-10">
      {/* ── HERO: the pitch ── */}
      <section className="relative pt-10 text-center sm:pt-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-80 max-w-3xl opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(50% 60% at 50% 30%, var(--color-violet-bright), transparent 70%)' }}
        />
        <div className="relative">
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.25em] text-ink-dim sm:text-base">For AI agents and the people who run them</div>
          <h1 className="mt-6 font-display text-[2.5rem] font-bold uppercase leading-[0.92] tracking-tight text-ink sm:text-7xl">
            Baskets,
            <br />
            <span className="spectral-text">operable by agents</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-balance text-base text-ink-dim sm:text-xl">
            This site ships with a Model Context Protocol server: any MCP-speaking agent (Claude, Cursor, your own)
            can discover baskets, read them, and compose buys, sells, migrations, creations and exits. The agent
            talks; your wallet signs.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/chat"
              className="rounded-full px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-void transition-transform hover:scale-[1.03]"
              style={{ background: GRADIENT }}
            >
              Try the in-site agent
            </Link>
            <a
              href="https://github.com/Irora-dev/Spectrum/tree/main/mcp"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/[0.16] bg-white/[0.06] px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-ink transition-colors hover:border-white/[0.3]"
            >
              The server, on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── the four claims that matter ── */}
      <section className="mt-14 grid gap-6 sm:grid-cols-2">
        {/* THE MISSING BOX IS THE POINT: the slot where a server would sit is
            drawn, dashed and empty, between the two things that do exist. */}
        <Claim
          title="Nothing to host"
          line="Your client spawns it per session, over stdio."
          figure={
            <div className="flex w-full items-center gap-2">
              <Node>your client</Node>
              <Arrow label="stdio" />
              <span className="flex shrink-0 flex-col items-center gap-1 rounded-lg border border-dashed border-ink/25 px-2.5 py-1.5">
                <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3 text-ink-faint">
                  <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">no server</span>
              </span>
              <Arrow />
              <Node tone="accent">the chains</Node>
            </div>
          }
        />
        {/* THE TWO KEYS ARE THE POINT: struck on the side that composes, live on
            the side that signs. An earlier version drew the signing boundary as
            a dashed vertical rule and it rendered as a 15px stub colliding with
            the arrowhead — the keys say it without the furniture, and three
            nodes match the row above. */}
        <Claim
          title="Never holds keys"
          line="Every action comes back for you to sign."
          figure={
            <div className="flex w-full items-center gap-2">
              <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/20 bg-ink/[0.04] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">
                <KeyGlyph struck />
                agent
              </span>
              <Arrow label="unsigned" />
              <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-bright/45 bg-violet-bright/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                <KeyGlyph />
                your wallet
              </span>
              <Arrow label="signed" />
              <Node>chain</Node>
            </div>
          }
        />
        {/* THE MEASUREMENT IS THE POINT: the floor is the far end of a band the
            simulation opens, and the only thing an agent hands over is how wide
            that band may be. */}
        <Claim
          title="Floors from live simulation"
          line="The real trade, minus your tolerance."
          figure={
            <div className="w-full">
              <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.14em]">
                <span className="text-cyan">simulated on chain</span>
                <span className="text-ink-dim">floor</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cyan" />
                {/* the band stays visible to its end: a floor is a definite
                    point, so fading it to nothing argued the opposite */}
                <span
                  className="h-1.5 flex-1 rounded-full"
                  style={{ background: 'linear-gradient(90deg,var(--color-cyan),color-mix(in srgb,var(--color-cyan) 45%,transparent))' }}
                />
                <span className="h-3.5 w-1 shrink-0 rounded-full bg-ink/70" />
              </div>
              <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                <svg viewBox="0 0 8 6" aria-hidden className="h-1.5 w-2">
                  <path d="M4 0 L8 6 L0 6 Z" fill="currentColor" />
                </svg>
                the agent sets only this width
              </div>
            </div>
          }
        />
        {/* THE ARTEFACT IS THE POINT: show an actual refusal, decoded, rather
            than describing the shape of one. */}
        <Claim
          title="Refuses in words"
          line="Refusals say what happened and what to do."
          figure={
            <div className="w-full rounded-xl border border-magenta/35 bg-magenta/[0.06] p-3">
              <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-magenta">
                <svg viewBox="0 0 12 12" aria-hidden className="h-2.5 w-2.5">
                  <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                refused
              </div>
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink">
                Chain 999 is not configured. Use 1, 8453 or 4663.
              </p>
            </div>
          }
        />
      </section>

      {/* ── what a conversation looks like ── */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">What it feels like</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-dim">
          Plain language in, real transactions out. The same flows power the <Link to="/chat" className="text-cyan hover:underline">in-site agent chat</Link>.
        </p>
        <div className="mt-4">
          <CodeBlock code={CONVERSATION} title="a session" />
        </div>
      </section>

      {/* ── the tools: mapped from the GENERATED manifest (mcp/build.mjs
             writes app/src/generated/mcp-tools.json from the live registry),
             so this table and the server cannot disagree ── */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">The tools</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-dim">
          {mcpManifest.tools.length} tools, each reusing the app&rsquo;s own money modules verbatim. This table is
          generated from the server&rsquo;s registry: the server and this site cannot disagree.
        </p>
        <div className="mt-4">
          <Table
            head={['Tool', 'Kind', 'What it does']}
            rows={mcpManifest.tools.map((t) => [
              <IC key={t.name}>{t.name}</IC>,
              t.kind,
              t.description,
            ])}
          />
        </div>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-dim">
          The server also ships two MCP prompts, <IC>spectrum-safety</IC> and <IC>spectrum-flows</IC>: the operating
          law (address provenance, review-then-confirm, floors never invented, the always-standing exit) and the
          worked buy, sell, and migrate sequences. Any prompt-aware client loads the safety persona for free.
          Repeated reads answer from a short cache; anything touching money runs fresh, every time.
        </p>
      </section>

      {/* ── quick start ── */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">Run it in five minutes</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CodeBlock code={BUILD} title="build" />
          <CodeBlock code={REGISTER} title="register (Claude Desktop / Claude Code / any MCP client)" />
        </div>
        <Callout>
          Live buy and sell quotes simulate the real trade first, which needs an RPC supporting{' '}
          <IC>eth_simulateV1</IC> or state overrides. Provider endpoints qualify; some public ones do not. Reads,
          create, and the exit work on any RPC. Full detail lives in the kit&rsquo;s <IC>mcp/README.md</IC>.
        </Callout>
      </section>

      {/* ── the Bankr lane ── */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">Bankr, and other agent marketplaces</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-dim">
          The kit ships a ready Bankr skill (<IC>mcp/bankr-skill/</IC>): the instructions that teach a marketplace
          agent to drive baskets safely. It carries the whole safety posture in its text, refusal grammar included:
          addresses only from the server&rsquo;s own tools, nothing executes without the review shown and confirmed,
          and floors are never invented.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Pillar title="Where the runtime speaks MCP">
            The skill points at this server and the agent gets all {mcpManifest.tools.length} tools: reads, quotes,
            floored composes, the unconditional exit. Everything on this page, driven from the marketplace.
          </Pillar>
          <Pillar title="Everywhere else: deep links">
            No process to spawn? The skill hands the user pre-filled links into any Spectrum site: a trade console
            with basket, amount and chain already set, basket pages for reads, referral credit riding the URL. The
            user signs on-site with every protection intact.
          </Pillar>
        </div>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-dim">
          Submitting it to the Bankr registry takes one pull request; <IC>mcp/bankr-skill/SUBMITTING.md</IC> has the
          steps, and <IC>bash mcp/run.sh --check</IC> proves an install end to end before you send it.
        </p>
      </section>

      {/* ── closing row ── */}
      <div className="mt-14 flex flex-wrap items-center gap-4 border-t border-white/10 pt-8">
        <Link
          to="/chat"
          className="rounded-full px-5 py-2.5 font-display text-sm font-bold text-void transition-transform hover:scale-[1.03]"
          style={{ background: GRADIENT }}
        >
          Talk to Agent Specter
        </Link>
        <Link to="/docs" className="rounded-full border border-white/[0.16] bg-white/[0.06] px-5 py-2.5 text-sm text-ink transition-colors hover:border-white/[0.3]">
          Developer docs
        </Link>
        <Link to="/integrate" className="rounded-full border border-white/[0.16] bg-white/[0.06] px-5 py-2.5 text-sm text-ink transition-colors hover:border-white/[0.3]">
          Route baskets
        </Link>
      </div>
    </div>
  )
}
