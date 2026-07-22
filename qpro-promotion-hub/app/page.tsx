"use client";

import { useState } from "react";

const brands = [
  { name: "QPRO MY", code: "MY", currency: "MYR", transfer: "RM 100", credit: "RM 10", rounds: "8x", color: "#7357ff" },
  { name: "QPRO SG", code: "SG", currency: "SGD", transfer: "S$ 50", credit: "S$ 5", rounds: "10x", color: "#12b981" },
  { name: "QPRO ID", code: "ID", currency: "IDR", transfer: "Rp 500K", credit: "Rp 50K", rounds: "8x", color: "#f59e0b" },
];

const campaigns = [
  { name: "Weekend Reload Booster", code: "WEEKEND25", brands: "3 brands", period: "18–20 Jul", status: "Scheduled", tone: "purple" },
  { name: "New Member Welcome", code: "WELCOME88", brands: "2 brands", period: "Always on", status: "Active", tone: "green" },
  { name: "Midweek Cashback", code: "MIDWEEK", brands: "QPRO MY", period: "16–17 Jul", status: "Review", tone: "amber" },
  { name: "VIP Birthday Reward", code: "VIPBDAY", brands: "3 brands", period: "Always on", status: "Active", tone: "green" },
];

export default function Home() {
  const [view, setView] = useState("Overview");
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brandmark"><span>Q</span><div>QPRO<strong>Promotion Hub</strong></div></div>
        <nav aria-label="Primary navigation">
          {["Overview", "Promotions", "Calendar", "Templates", "Approvals", "Reports"].map((item) => (
            <button key={item} className={view === item ? "navitem active" : "navitem"} onClick={() => setView(item)}>
              <i>{item === "Overview" ? "⌂" : item === "Promotions" ? "◇" : item === "Calendar" ? "□" : item === "Templates" ? "▤" : item === "Approvals" ? "✓" : "↗"}</i>{item}
              {item === "Approvals" && <em>3</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="navitem"><i>⚙</i>Settings</button>
          <div className="profile"><div className="avatar">JM</div><div><b>Jamie Morgan</b><small>Promotion Manager</small></div><span>⋮</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header>
          <div><p className="eyebrow">UNIFIED BACK OFFICE</p><h1>{view === "Overview" ? "Good morning, Jamie" : view}</h1><p className="sub">Here’s what’s happening across your QPRO brands today.</p></div>
          <div className="head-actions"><button className="iconbtn" aria-label="Notifications">♢<b>2</b></button><button className="primary" onClick={() => setModal(true)}>＋ Create promotion</button></div>
        </header>

        <div className="scopebar">
          <div><span className="statusdot" /> Viewing <strong>All QPRO brands</strong><small>3 workspaces connected</small></div>
          <button onClick={() => notify("Brand workspace selector opened")}>Manage scope <span>›</span></button>
        </div>

        <section className="metrics">
          <article><div className="metric-icon purple">◇</div><div><p>Active promotions</p><h2>12</h2><small><b>↑ 2</b> from last week</small></div><span className="spark purple-spark">⌁</span></article>
          <article><div className="metric-icon blue">◷</div><div><p>Scheduled</p><h2>6</h2><small>Next launch in <b>2 days</b></small></div><span className="spark blue-spark">⌁</span></article>
          <article><div className="metric-icon amber">!</div><div><p>Awaiting approval</p><h2>3</h2><small><b className="orange">1 urgent review</b></small></div><button className="textlink" onClick={() => setView("Approvals")}>Review →</button></article>
          <article><div className="metric-icon green">✓</div><div><p>Validation health</p><h2>98.6%</h2><small><b>All systems healthy</b></small></div><span className="ring">99</span></article>
        </section>

        <section className="grid">
          <article className="panel campaigns">
            <div className="panelhead"><div><h3>Promotion activity</h3><p>Campaigns across all selected brands</p></div><button onClick={() => setView("Promotions")}>View all <span>→</span></button></div>
            <div className="tabs"><button className="on">All <span>21</span></button><button>Active <span>12</span></button><button>Scheduled <span>6</span></button><button>Draft <span>3</span></button></div>
            <div className="table">
              <div className="tr th"><span>CAMPAIGN</span><span>SCOPE</span><span>PERIOD</span><span>STATUS</span><span></span></div>
              {campaigns.map((c, i) => <div className="tr" key={c.code}>
                <span><i className={"campaign-icon c" + i}>✦</i><b>{c.name}</b><small>{c.code}</small></span>
                <span><div className="mini-brands"><i>MY</i>{c.brands.includes("3") && <i>SG</i>}{(c.brands.includes("3") || c.brands.includes("2")) && <i>ID</i>}</div><small>{c.brands}</small></span>
                <span><b>{c.period}</b><small>{i === 0 ? "Starts 10:00 MYT" : i === 2 ? "Ends tomorrow" : "Rolling campaign"}</small></span>
                <span><label className={"pill " + c.tone}>{c.status}</label></span>
                <button aria-label={"Open " + c.name} onClick={() => notify(c.name + " opened")}>⋮</button>
              </div>)}
            </div>
          </article>

          <aside className="rightcol">
            <article className="panel attention">
              <div className="panelhead"><div><h3>Needs attention</h3><p>Resolve before publishing</p></div><span className="badge">3</span></div>
              <button onClick={() => notify("Validation issue opened")}><i className="warn">!</i><span><b>Message mismatch</b><small>MIDWEEK · QPRO MY</small><em>SMS says RM 8, system is RM 10</em></span><strong>›</strong></button>
              <button onClick={() => notify("Translation task opened")}><i className="info">文</i><span><b>Translation missing</b><small>WEEKEND25 · QPRO ID</small><em>Bahasa Indonesia required</em></span><strong>›</strong></button>
              <button onClick={() => notify("Approval task opened")}><i className="clock">◷</i><span><b>Approval overdue</b><small>JULYVIP · Multi-brand</small><em>Waiting 18 hours</em></span><strong>›</strong></button>
              <a onClick={() => setView("Approvals")}>Open validation centre <span>→</span></a>
            </article>
            <article className="panel quick">
              <div className="panelhead"><div><h3>Quick actions</h3><p>Common promotion tasks</p></div></div>
              <div><button onClick={() => setModal(true)}><i>＋</i><b>New campaign</b><small>Start from scratch</small></button><button onClick={() => notify("Template library opened")}><i>▤</i><b>Use template</b><small>22 ready to use</small></button><button onClick={() => notify("Clone workflow opened")}><i>⧉</i><b>Clone campaign</b><small>Copy an existing setup</small></button><button onClick={() => notify("Brand comparison opened")}><i>⇄</i><b>Compare brands</b><small>Spot differences fast</small></button></div>
            </article>
          </aside>
        </section>

        <section className="panel brand-health">
          <div className="panelhead"><div><h3>Brand workspace health</h3><p>Configuration readiness across your connected brands</p></div><button onClick={() => notify("Detailed brand health opened")}>View details →</button></div>
          <div className="brandcards">{brands.map((b) => <article key={b.code} style={{"--brand": b.color} as React.CSSProperties}><div className="brandtop"><i>{b.code}</i><div><b>{b.name}</b><small>{b.currency} · MYT</small></div><label>Healthy</label></div><div className="brandstats"><span><small>ACTIVE</small><b>{b.code === "MY" ? 6 : 3}</b></span><span><small>SCHEDULED</small><b>{b.code === "ID" ? 3 : 2}</b></span><span><small>ISSUES</small><b>{b.code === "MY" ? 1 : 0}</b></span></div><div className="progress"><i style={{width: b.code === "MY" ? "92%" : "100%"}} /></div><small>{b.code === "MY" ? "1 copy mismatch to resolve" : "All checks passed"}</small></article>)}</div>
        </section>
      </section>

      {modal && <div className="modalback" onMouseDown={() => setModal(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="close" onClick={() => setModal(false)}>×</button><p className="eyebrow">NEW MULTI-BRAND CAMPAIGN</p><h2>Create promotion</h2><p>Choose how you want to begin. Brand-specific values can be adjusted before publishing.</p><div className="choices"><button onClick={() => notify("Blank campaign created")}><i>＋</i><span><b>Start from scratch</b><small>Build a new promotion with guided validation.</small></span></button><button onClick={() => notify("Template library opened")}><i>▤</i><span><b>Use a template</b><small>Choose from 22 approved promotion templates.</small></span></button><button onClick={() => notify("Clone workflow opened")}><i>⧉</i><span><b>Clone an existing campaign</b><small>Reuse mechanics and adapt brand variants.</small></span></button></div></section></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
