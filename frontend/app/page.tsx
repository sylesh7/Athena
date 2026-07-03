import Loader from "@/components/Loader";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import Marquee from "@/components/Marquee";
import {
  Hero,
  Statement,
  Future,
  Pods,
  Solar,
  Divisions,
  Story,
  Footer,
} from "@/components/sections";

export default function Home() {
  return (
    <>
      <Cursor />
      <Loader />
      <Nav />
      <main>
        <Hero />
        <Statement />
        <Future />
        <Marquee text="FATES PROGRAM" />
        <Pods />
        <Solar />
        <Divisions />
        <Story />
      </main>
      <Footer />
    </>
  );
}
