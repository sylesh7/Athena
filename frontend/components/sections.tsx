import Image from "next/image";
import Reveal from "./Reveal";

const IMG = "/image";

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-bg" />
      <div className="hero-orb-swirl" />
      <div className="hero-stars" />
      <div className="hero-grid" />
      <div className="hero-content">
        <h1 className="hero-wordmark">ATHENA</h1>
      </div>
      <div className="scroll-cue" />
    </header>
  );
}

export function Statement() {
  return (
    <section className="section statement" id="about">
      <Reveal as="h2">
        Athena seals its routing prediction on-chain before it spends a cent,{" "}
        <span className="dim">and lets the outcome decide</span> who gets paid
      </Reveal>
      <Reveal>
        <a className="btn-ghost" href="#">
          <span>VIEW ON ARCSCAN</span>
        </a>
      </Reveal>
    </section>
  );
}

export function Future() {
  return (
    <section className="section future">
      <Image
        className="lines"
        src={`${IMG}/63b814185c1004559b3cafd0_lines.svg`}
        alt=""
        width={224}
        height={120}
      />
      <Reveal as="h2">
        Sealed Before
        <br />
        It Runs
      </Reveal>
      <Reveal as="p">
        Before a single call streams, Athena hashes its routing decision — chosen
        provider, predicted quality, predicted latency, confidence — and commits
        it to a smart contract on Arc, posting a USDC bond against that
        prediction. An MCP quality monitor scores every call as it lands. If the
        stream matches what was predicted, the bond returns. If it doesn&apos;t,
        it slashes to the client automatically.
      </Reveal>
    </section>
  );
}

export function Pods() {
  return (
    <section className="section pods">
      <Reveal className="pods-visual">
        <Image
          className="rock"
          src={`${IMG}/Athena.png`}
          alt="Athena Protocol"
          fill
          sizes="(max-width: 820px) 100vw, 50vw"
        />
      </Reveal>
      <Reveal className="pods-panel">
        <div>
          <div className="top">LIVE ON ARC TESTNET</div>
          <div className="year mono">2026</div>
        </div>
        <div>
          <h3>
            Start a
            <br />
            Stream
          </h3>
          <p className="desc">
            Connect your wallet, post a bond, and watch Athena commit a sealed
            routing decision before a single USDC nanopayment streams to the
            chosen provider. No committee decides the outcome — the prediction
            does.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

export function Solar() {
  return (
    <section className="section solar">
      <div className="solar-bg" />
      <div className="orbit o1" />
      <div className="orbit o2" />
      <div className="orbit o3" />
      <div className="orbit o4" />
      <div className="solar-sun">
        <Image src={`${IMG}/lepton.jpg`} alt="Lepton" fill sizes="224px" style={{ objectFit: "cover" }} />
      </div>
      <div className="solar-content">
        <Reveal className="eyebrow">Settled On Arc</Reveal>
        <Reveal as="h2">50+ On-Chain Settlements Per Run</Reveal>
        <Reveal className="sub">
          Every commit, bond, reveal, and settlement
          <br />
          logged live on Arcscan
        </Reveal>
      </div>
    </section>
  );
}

const DIVISIONS = [
  { n: "D—001", name: "WALLETS", src: "63b814185c1004322b3cafe3_hive_20__20logo.svg" },
  { n: "D—002", name: "GATEWAY", src: "63b814185c100416813cafe7_forge_20__20logo.svg" },
  { n: "D—003", name: "X402", src: "63b814185c10045c303cafdf_scout_20__20logo.svg" },
  { n: "D—004", name: "MARKETPLACE", src: "63b814185c10046cb73cafeb_oath_20__20logo.svg" },
  { n: "D—005", name: "CCTP", src: "63b814185c10045ddf3cafdd_labs_20__20logo.svg" },
];

export function Divisions() {
  return (
    <section className="section divisions">
      <div className="band plain">
        <div className="track" style={{ fontSize: "clamp(1.6rem,4vw,3.4rem)", color: "var(--muted)" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i}>
              The Protocol <span>*</span>{" "}
            </span>
          ))}
        </div>
      </div>

      <Reveal className="div-grid">
        {DIVISIONS.map((d) => (
          <div className="div-cell" key={d.name}>
            <div className="dnum">{d.n}</div>
            <Image src={`${IMG}/${d.src}`} alt={d.name} width={40} height={40} />
            <div className="dname">{d.name}</div>
          </div>
        ))}
      </Reveal>

      <div className="div-intro">
        <Reveal as="h3">Athena: A Trust-Minimized Agent Broker on Arc</Reveal>
        <div>
          <Reveal as="p">
            Every stream relies on five Circle building blocks working together —
            policy-controlled agent wallets, Gateway nanopayments, x402 payment
            triggers, marketplace discovery, and CCTP for cross-chain payouts.
          </Reveal>
          <Reveal>
            <a className="btn-ghost" href="#">
              <span>READ THE PROTOCOL</span>
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const CHAPTERS = [
  {
    idx: "CHAPTER 01",
    title: ["The Payment"],
    body: [
      "A client pays a single x402 nanopayment to Athena's Gateway-protected endpoint — one signature, one session.",
      "That single payment is all it takes to trigger the entire stream. Nothing else is manual from here.",
    ],
  },
  {
    idx: "CHAPTER 02",
    title: ["The", "Commitment"],
    body: [
      "Athena reads the Circle Agent Marketplace and evaluates providers by ERC-8004 reputation, price, and endpoint count.",
      "It forms a structured decision — chosen provider, predicted quality, predicted latency, confidence — hashes it, commits the hash on-chain, and posts a USDC bond against its own prediction.",
    ],
  },
  {
    idx: "CHAPTER 03",
    title: ["The", "Stream"],
    body: [
      "Nanopayments flow to the chosen provider via x402 as each result arrives.",
      "An MCP quality monitor scores every call for quality and latency, live. Fall short too many times in a row, and the stream stops.",
    ],
  },
  {
    idx: "FOUNDATION",
    title: ["The", "Settlement"],
    body: [
      "When the stream ends, Athena reveals the sealed decision. The contract checks the hash matches — no rewriting history after the fact.",
      "If the prediction held, the bond releases back to Athena and reputation updates on ERC-8004. If it didn't, the bond slashes to the client automatically. No committee, no dispute, no delay.",
    ],
  },
];

export function Story() {
  return (
    <section className="section story">
      {CHAPTERS.map((c) => (
        <div className="chapter" key={c.idx + c.title[0]}>
          <Reveal>
            <div className="idx">{c.idx}</div>
            <h3>
              {c.title.map((t, i) => (
                <span key={i}>
                  {t}
                  {i < c.title.length - 1 && <br />}
                </span>
              ))}
            </h3>
          </Reveal>
          <Reveal>
            {c.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </Reveal>
        </div>
      ))}
    </section>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="foot-band">
        <div className="track">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i}>
              STREAMING LIVE <span>*</span>{" "}
            </span>
          ))}
        </div>
      </div>
      <div className="foot-main">
        <div className="foot-logo foot-logo-text">ATHENA</div>
        <div className="foot-links">
          <a href="#">GitHub</a>
          <a href="#">Twitter</a>
          <a href="#">Arcscan</a>
          <a href="#">Docs</a>
        </div>
      </div>
      <div className="foot-bottom">
        <span>© 2026 ATHENA — TRUST-MINIMIZED AGENT BROKER ON ARC</span>
        <a href="#">Privacy Policy</a>
      </div>
    </footer>
  );
}
