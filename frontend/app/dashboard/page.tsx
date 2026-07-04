import Link from "next/link";
import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import { DashboardStats, SessionList } from "@/components/Dashboard";
import { Footer } from "@/components/sections";

export default function DashboardPage() {
  return (
    <>
      <Cursor />
      <Nav />
      <main className="dashboard-page">
        <section className="section">
          <div className="dash-head">
            <div>
              <div className="eyebrow">Dashboard</div>
              <h1>Stream Sessions</h1>
            </div>
            <Link className="btn-ghost" href="/new-stream">
              <span>New Stream</span>
            </Link>
          </div>
          <DashboardStats />
          <SessionList />
        </section>
      </main>
      <Footer />
    </>
  );
}
