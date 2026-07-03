import Image from "next/image";
import Reveal from "./Reveal";

const IMG = "/image";

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-bg" />
      <div className="hero-stars" />
      <div className="hero-grid" />
      <div className="hero-content">
        <h1 className="hero-wordmark">FATES</h1>
      </div>
      <div className="scroll-cue" />
    </header>
  );
}

export function Statement() {
  return (
    <section className="section statement" id="about">
      <Reveal as="h2">
        FATES is an immersive, narrative-driven,{" "}
        <span className="dim">web3 experience</span> following the next step in
        human survival
      </Reveal>
      <Reveal>
        <a className="btn-ghost" href="#">
          <Image src={`${IMG}/63b814185c10040da13cafe8_discord.svg`} alt="" width={20} height={20} />
          <span>JOIN DISCORD</span>
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
        The Future
        <br />
        of Humanity
      </Reveal>
      <Reveal as="p">
        A mysterious and unstoppable force is consuming our planet. Known only as
        the Braid, this dangerous anomaly is a threat to our entire existence. To
        ensure the survival of our species, we must retreat into the solar system
        and establish new homes among the stars.
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
          src={`${IMG}/63b814185c10049d473cafee_asteroid_1.png`}
          alt="Asteroid"
          width={520}
          height={520}
        />
      </Reveal>
      <Reveal className="pods-panel">
        <div>
          <div className="top">PODS LAUNCHING NOW</div>
          <div className="year mono">2022</div>
        </div>
        <div>
          <h3>
            Join the
            <br />
            Fates Program
          </h3>
          <p className="desc">
            We need brave volunteers to venture out and settle new lands. It will
            be difficult and dangerous, but, ultimately, our only chance.
            Resources, however, are seriously limited and initially there will
            only be a small number of evacuation pods available.
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
      <div className="solar-sun" />
      <div className="solar-content">
        <Reveal className="eyebrow">Destination: Asteroids</Reveal>
        <Reveal as="h2">1.2 Million Real Asteroids</Reveal>
        <Reveal className="sub">
          Set the stage for our future
          <br />
          amongst the stars
        </Reveal>
      </div>
    </section>
  );
}

const DIVISIONS = [
  { n: "D—001", name: "HIVE", src: "63b814185c1004322b3cafe3_hive_20__20logo.svg" },
  { n: "D—002", name: "FORGE", src: "63b814185c100416813cafe7_forge_20__20logo.svg" },
  { n: "D—003", name: "SCOUT", src: "63b814185c10045c303cafdf_scout_20__20logo.svg" },
  { n: "D—004", name: "OATH", src: "63b814185c10046cb73cafeb_oath_20__20logo.svg" },
  { n: "D—005", name: "LABS", src: "63b814185c10045ddf3cafdd_labs_20__20logo.svg" },
];

export function Divisions() {
  return (
    <section className="section divisions">
      <div className="band plain">
        <div className="track" style={{ fontSize: "clamp(1.6rem,4vw,3.4rem)", color: "var(--muted)" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i}>
              The Divisions <span>*</span>{" "}
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
        <Reveal as="h3">ASH: The Assembly for the Survival of Humanity</Reveal>
        <div>
          <Reveal as="p">
            As you start your new life as part of the Assembly, you will be
            assigned divisions that reflect your role and aptitude. The FATES
            Program has five divisions, each in possession of unique values
            deemed vital for humanity.
          </Reveal>
          <Reveal>
            <a className="btn-ghost" href="#">
              <span>FIND YOUR DIVISION</span>
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
    title: ["The Expansion"],
    body: [
      "A long time ago our ancestors roamed our solar system freely. They called it the Expansion Age.",
      "Eventually, the Expansion came to an end — collapsing under its own economic weight and forcing humanity to abandon space. Humanity returned to the safety of Earth as quickly as possible, leaving a vast amount of technology and materials behind.",
    ],
  },
  {
    idx: "CHAPTER 02",
    title: ["The Braid", "Incident"],
    body: [
      "In an attempt to get humanity back on its feet, our leaders were eager to prove our pre-eminence once more by pushing the boundaries of science.",
      "But instead of leading us into a brighter future, a situation arose within the VAU Research Facility. Where, although not clear, it was rumoured they studied a new type of matter. The incident led to the creation of the catastrophic anomaly known as the Braid, which is now slowly engulfing our planet.",
    ],
  },
  {
    idx: "CHAPTER 03",
    title: ["A World", "Unthreading"],
    body: [
      "A direct consequence of the Braid is a condition known as Unthreading.",
      "Any matter lost to Unthreading is gone forever.",
    ],
  },
  {
    idx: "FOUNDATION",
    title: ["The Fates", "Program"],
    body: [
      "The Fates Program is the main objective of ASH. It is a colonisation mission designed to give our species its best chance of survival in space.",
      "By cleverly repurposing abandoned technologies from the Expansion Age, ASH has created one-person pods capable of space travel. Each pod will land on one of the 1.2 million asteroids in our solar system, personally selected by each pilot.",
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
              EVACUATING NOW <span>*</span>{" "}
            </span>
          ))}
        </div>
      </div>
      <div className="foot-main">
        <div className="foot-logo">
          <Image
            src={`${IMG}/63b814185c100484f23cb00c_fates_logo_footer.svg`}
            alt="FATES"
            width={144}
            height={40}
          />
        </div>
        <div className="foot-links">
          <a href="#">Discord</a>
          <a href="#">Twitter</a>
          <a href="#">OpenSea</a>
          <a href="#">Those Beyond</a>
        </div>
      </div>
      <div className="foot-bottom">
        <span>© FATES WORLD — THE NEXT STEP IN HUMAN SURVIVAL</span>
        <a href="#">Privacy Policy</a>
      </div>
    </footer>
  );
}
