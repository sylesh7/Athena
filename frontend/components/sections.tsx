import Image from "next/image";
import Reveal from "./Reveal";
import ParallaxLayer from "./ParallaxLayer";
import HeroTilt from "./HeroTilt";
import { GLSLHills } from "./ui/glsl-hills";

const IMG = "/image";

export function Hero() {
  return (
    <header className="hero" id="top">
      <ParallaxLayer speed={0.12} className="hero-bg-layer">
        <GLSLHills />
        <div className="hero-bg" />
      </ParallaxLayer>
      <div className="hero-stars" />
      <div className="hero-grid" />
      <HeroTilt className="hero-tilt">
        <ParallaxLayer speed={0.3} fade className="hero-content">
          <div className="hero-eyebrow">TAMEION AGENTS HACKATHON</div>
          <h1 className="hero-wordmark">ATHENA</h1>
          <div className="hero-sub">Autonomous Business Treasury on Arc</div>
        </ParallaxLayer>
      </HeroTilt>
      <div className="scroll-cue" />
    </header>
  );
}

export function Statement() {
  return (
    <section className="section statement" id="about">
      <Reveal as="h2">
        Athena seals every treasury decision on-chain before a cent moves,{" "}
        <span className="dim">and freezes itself</span> if it ever fails to prove what it did
      </Reveal>
      <Reveal>
        <a className="btn-ghost" href="https://explorer.testnet.arc.io" target="_blank" rel="noopener noreferrer">
          <span>VIEW ON ARC EXPLORER</span>
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
        Committed
        <br />
        Before It Acts
      </Reveal>
      <Reveal as="p">
        Before any payment leaves the treasury, Athena hashes its full
        decision — the balance it read, the forecast it ran, the rule it
        applied, the invoice it matched, and the amount it intends to send —
        and commits that hash to the{" "}
        <span style={{ color: "var(--gold-glow)" }}>AthenaTreasury</span>{" "}
        contract on Arc. The contract then executes the payment. Afterwards
        Athena reveals the full record and the contract verifies the hash
        matches. An agent that never reveals gets frozen — it cannot commit
        or pay again until its arrears are cleared.
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
          <div className="top">TAMEION · ANCIENT GREEK FOR TREASURY</div>
          <div className="year mono">2026</div>
        </div>
        <div>
          <h3>
            The Treasury
            <br />
            Agent
          </h3>
          <p className="desc">
            Athena holds USDC and EURC in a smart contract, reads invoices,
            runs a 30-day cash-flow forecast, decides when to pay, and
            executes — all without a human key. Every decision is sealed on
            Arc before execution and verified on reveal. Escalations that
            exceed the agent&apos;s authority surface to a human approver via
            wallet signature.
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
        <Image src={`${IMG}/tameion-seal.jpg`} alt="Tameion seal" fill sizes="224px" style={{ objectFit: "cover", borderRadius: "50%" }} />
      </div>
      <div className="solar-content">
        <Reveal className="eyebrow">Live on Arc Testnet · Tameion Hackathon</Reveal>
        <Reveal as="h2">Every Decision Sealed On-Chain</Reveal>
        <Reveal className="sub">
          Commit hash · Execute payment · Reveal record
          <br />
          All logged and verifiable on Arc
        </Reveal>
      </div>
    </section>
  );
}

const DIVISIONS = [
  { n: "D—001", name: "WALLETS", label: "DCW + Agent Wallets", src: "63b814185c1004322b3cafe3_hive_20__20logo.svg" },
  { n: "D—002", name: "GATEWAY", label: "Unified Balance", src: "63b814185c100416813cafe7_forge_20__20logo.svg" },
  { n: "D—003", name: "CCTP V2", label: "Cross-Chain", src: "63b814185c10045c303cafdf_scout_20__20logo.svg" },
  { n: "D—004", name: "EARN KIT", label: "Idle Yield", src: "63b814185c10046cb73cafeb_oath_20__20logo.svg" },
  { n: "D—005", name: "COMPLIANCE", label: "Payee Screening", src: "63b814185c10045ddf3cafdd_labs_20__20logo.svg" },
];

export function Divisions() {
  return (
    <section className="section divisions">
      <div className="band plain">
        <div className="track" style={{ fontSize: "clamp(1.6rem,4vw,3.4rem)", color: "var(--muted)" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i}>
              COMMIT <span>*</span> EXECUTE <span>*</span> REVEAL <span>*</span>{" "}
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
            <div className="dlabel">{d.label}</div>
          </div>
        ))}
      </Reveal>

      <div className="div-intro">
        <Reveal as="h3">Athena: Autonomous Business Treasury on Arc</Reveal>
        <div>
          <Reveal as="p">
            The treasury runs on five Circle building blocks: Developer-Controlled
            Wallets with spending policies, Gateway unified balance and
            consolidation, CCTP V2 for cross-chain vendor payments, Earn Kit for
            yield on idle USDC, and the Compliance Engine to screen every payee
            before they are ever activated.
          </Reveal>
          <Reveal>
            <a className="btn-ghost" href="https://tameion.thecanteenapp.com" target="_blank" rel="noopener noreferrer">
              <span>TAMEION HACKATHON</span>
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
    title: ["The", "Obligation"],
    body: [
      "An invoice arrives — from email, upload, or API. Athena extracts the fields with an LLM, then validates them strictly: decimals, duplicates, three-way match against the purchase order and receipt.",
      "The model suggests. Deterministic code decides. A mismatched amount or an unknown payee becomes a hold, not a payment.",
    ],
  },
  {
    idx: "CHAPTER 02",
    title: ["The", "Commitment"],
    body: [
      "Athena reads the treasury balance, runs a 30-day cash-flow forecast, and applies policy math: discount APRs, liquidity floor, surplus, priorities.",
      "It hashes the full decision record — what it saw, what it forecast, what rule it applied, what it intends to pay — and commits that hash to AthenaTreasury on Arc before any money moves.",
    ],
  },
  {
    idx: "CHAPTER 03",
    title: ["The", "Execution"],
    body: [
      "The contract executes the payment. It re-checks every rule: budget, payee cap, payee activation cooldown, operating floor. A payment that would violate any rule is escalated to the human approver instead.",
      "Cross-chain vendors receive USDC via CCTP V2. Euro invoices are settled in EURC after an App Kit swap.",
    ],
  },
  {
    idx: "FOUNDATION",
    title: ["The", "Reveal"],
    body: [
      "After execution, Athena publishes the full decision record on-chain. The contract recomputes the SHA-256 hash and refuses a record that does not match what was committed.",
      "An agent that fails to reveal on time is frozen — it cannot commit new decisions or move money until every overdue record is published. The chain is the permanent, tamper-evident audit trail.",
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
      <div className="foot-main">
        <div className="foot-logo foot-logo-text">ATHENA</div>
        <div className="foot-links">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://explorer.testnet.arc.io" target="_blank" rel="noopener noreferrer">Arc Explorer</a>
          <a href="https://tameion.thecanteenapp.com" target="_blank" rel="noopener noreferrer">Tameion</a>
          <a href="/dashboard">Dashboard</a>
        </div>
      </div>
      <div className="foot-bottom">
        <span>© 2026 ATHENA — AUTONOMOUS BUSINESS TREASURY ON ARC · TAMEION HACKATHON</span>
        <a href="https://tameion.thecanteenapp.com" target="_blank" rel="noopener noreferrer">Canteen × Circle × Arc</a>
      </div>
    </footer>
  );
}
