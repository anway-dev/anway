"use client";
import { useState, useEffect } from "react";
import { PreviewBanner } from "@/components/preview-banner";

type EditorState = "writing" | "analyzing" | "gate" | "running" | "done";
type BottomTab = "problems" | "tests" | "terminal";
type ActivityTab = "explorer" | "search" | "git";

const SYNTAX: { text: string; color: string }[][] = [
  [{ text: "import", color: "#c586c0" }, { text: " { db } ", color: "#d4d4d4" }, { text: "from", color: "#c586c0" }, { text: " '../lib/db'", color: "#ce9178" }],
  [{ text: "import", color: "#c586c0" }, { text: " { paymentService } ", color: "#d4d4d4" }, { text: "from", color: "#c586c0" }, { text: " '../services/payment'", color: "#ce9178" }],
  [],
  [{ text: "export", color: "#c586c0" }, { text: " async ", color: "#c586c0" }, { text: "function", color: "#c586c0" }, { text: " quickCheckout", color: "#dcdcaa" }, { text: "(req, res) {", color: "#d4d4d4" }],
  [{ text: "  ", color: "#d4d4d4" }, { text: "const", color: "#c586c0" }, { text: " { userId, methodId, amount, currency } = req.body", color: "#d4d4d4" }],
  [],
  [{ text: "  // fetch saved payment method", color: "#6a9955" }],
  [{ text: "  ", color: "#d4d4d4" }, { text: "const", color: "#c586c0" }, { text: " method = ", color: "#d4d4d4" }, { text: "await", color: "#c586c0" }, { text: " db.paymentMethods.", color: "#d4d4d4" }, { text: "findOne", color: "#dcdcaa" }, { text: "(methodId)", color: "#d4d4d4" }],
  [{ text: "  ", color: "#d4d4d4" }, { text: "if", color: "#c586c0" }, { text: " (!method || method.userId !== userId) {", color: "#d4d4d4" }],
  [{ text: "    return", color: "#c586c0" }, { text: " res.", color: "#d4d4d4" }, { text: "status", color: "#dcdcaa" }, { text: "(", color: "#d4d4d4" }, { text: "403", color: "#b5cea8" }, { text: ").", color: "#d4d4d4" }, { text: "json", color: "#dcdcaa" }, { text: "({ error: ", color: "#d4d4d4" }, { text: "'Forbidden'", color: "#ce9178" }, { text: " })", color: "#d4d4d4" }],
  [{ text: "  }", color: "#d4d4d4" }],
  [],
  [{ text: "  // create payment", color: "#6a9955" }],
  [{ text: "  ", color: "#d4d4d4" }, { text: "const", color: "#c586c0" }, { text: " payment = ", color: "#d4d4d4" }, { text: "await", color: "#c586c0" }, { text: " paymentService.", color: "#d4d4d4" }, { text: "create", color: "#dcdcaa" }, { text: "({", color: "#d4d4d4" }],
  [{ text: "    userId, methodId, amount, currency", color: "#d4d4d4" }],
  [{ text: "  })", color: "#d4d4d4" }],
  [],
  [{ text: "  return", color: "#c586c0" }, { text: " res.", color: "#d4d4d4" }, { text: "status", color: "#dcdcaa" }, { text: "(", color: "#d4d4d4" }, { text: "201", color: "#b5cea8" }, { text: ").", color: "#d4d4d4" }, { text: "json", color: "#dcdcaa" }, { text: "(payment)", color: "#d4d4d4" }],
  [{ text: "}", color: "#d4d4d4" }],
];

const FINDINGS = [
  { line: 8,  severity: "warn",  title: "No input validation",    body: "amount and currency are passed directly to paymentService.create() without validation. Negative amounts and unsupported currencies will cause downstream errors.", test: "POST /checkout { amount: -100 } → expect 422" },
  { line: 14, severity: "error", title: "Race condition possible", body: "No idempotency check before creating payment. Concurrent requests with the same methodId could create duplicate charges.", test: "Concurrent POST with same body → expect same paymentId" },
];

const TEST_PLAN = [
  { id: "TC-001", label: "Happy path — low value, no 3DS",         status: "queued" },
  { id: "TC-002", label: "amount: -100 → expect 422",              status: "queued", generated: true },
  { id: "TC-003", label: "Invalid methodId → expect 403",          status: "queued" },
  { id: "TC-004", label: "Unsupported currency → expect 422",      status: "queued", generated: true },
  { id: "TC-005", label: "Concurrent duplicate → same paymentId",  status: "queued", generated: true },
  { id: "TC-006", label: "Expired payment method → expect 402",    status: "queued" },
  { id: "TC-007", label: "Missing required fields → expect 400",   status: "queued", generated: true },
];

const RUN_SEQUENCE: { id: string; result: "pass" | "fail"; ms: number }[] = [
  { id: "TC-001", result: "pass", ms: 234 },
  { id: "TC-003", result: "pass", ms: 89 },
  { id: "TC-006", result: "pass", ms: 145 },
  { id: "TC-007", result: "pass", ms: 67 },
  { id: "TC-002", result: "pass", ms: 312 },
  { id: "TC-004", result: "pass", ms: 198 },
  { id: "TC-005", result: "fail", ms: 890 },
];

const FILE_TREE = [
  { name: "payments-service", isDir: true, depth: 0, open: true },
  { name: "routes", isDir: true, depth: 1, open: true },
  { name: "checkout.ts", isDir: false, depth: 2, active: true, modified: true },
  { name: "payment.ts", isDir: false, depth: 2 },
  { name: "refund.ts", isDir: false, depth: 2 },
  { name: "services", isDir: true, depth: 1, open: true },
  { name: "payment.ts", isDir: false, depth: 2 },
  { name: "risk.ts", isDir: false, depth: 2 },
  { name: "utils", isDir: true, depth: 1, open: true },
  { name: "validation.ts", isDir: false, depth: 2 },
  { name: "idempotency.ts", isDir: false, depth: 2 },
];

const ACTIVITY_ICONS: { id: ActivityTab; icon: string; title: string }[] = [
  { id: "explorer", icon: "⊞", title: "Explorer" },
  { id: "search",   icon: "⊙", title: "Search" },
  { id: "git",      icon: "⬡", title: "Source Control" },
];

const TERMINAL_LINES = [
  { text: "$ pnpm test --watch", color: "#d4d4d4" },
  { text: "", color: "" },
  { text: "  payments-service › routes › checkout", color: "#888" },
  { text: "", color: "" },
  { text: "  ✓ TC-001 happy path (234ms)", color: "#10b981" },
  { text: "  ✓ TC-002 negative amount (312ms)", color: "#10b981" },
  { text: "  ✓ TC-003 invalid method (89ms)", color: "#10b981" },
  { text: "  ✓ TC-004 unsupported currency (198ms)", color: "#10b981" },
  { text: "  ✗ TC-005 concurrent duplicate (890ms)", color: "#ef4444" },
  { text: "  ✓ TC-006 expired method (145ms)", color: "#10b981" },
  { text: "  ✓ TC-007 missing fields (67ms)", color: "#10b981" },
  { text: "", color: "" },
  { text: "  Tests: 6 passed, 1 failed, 7 total", color: "#d4d4d4" },
  { text: "  Time: 2.0s", color: "#888" },
];

export function EditorView() {
  const [state, setState] = useState<EditorState>("writing");
  const [activeFinding, setActiveFinding] = useState<number | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [testResults, setTestResults] = useState<Record<string, "pass" | "fail">>({});
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [runIndex, setRunIndex] = useState(0);
  const [bottomTab, setBottomTab] = useState<BottomTab>("problems");
  const [activityTab, setActivityTab] = useState<ActivityTab>("explorer");
  const [showSidebar, setShowSidebar] = useState(true);
  const [bottomHeight, setBottomHeight] = useState(180);

  useEffect(() => {
    if (state !== "analyzing") return;
    const t = setInterval(() => {
      setAnalysisProgress((p) => {
        if (p >= 100) { clearInterval(t); setState("gate"); return 100; }
        return p + 6;
      });
    }, 80);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    if (state !== "running") return;
    if (runIndex >= RUN_SEQUENCE.length) { setTimeout(() => { setState("done"); setBottomTab("tests"); }, 0); return; }
    const { id, result, ms } = RUN_SEQUENCE[runIndex];
    const t = setTimeout(() => {
      setActiveTest(id);
      setTimeout(() => {
        setTestResults((prev) => ({ ...prev, [id]: result }));
        setActiveTest(null);
        setRunIndex((i) => i + 1);
      }, Math.min(ms, 500));
    }, 0);
    return () => clearTimeout(t);
  }, [state, runIndex]);

  const passCount = Object.values(testResults).filter(r => r === "pass").length;
  const failCount = Object.values(testResults).filter(r => r === "fail").length;
  const showFindings = state === "gate" || state === "running" || state === "done";
  const errorCount = showFindings ? FINDINGS.filter(f => f.severity === "error").length : 0;
  const warnCount = showFindings ? FINDINGS.filter(f => f.severity === "warn").length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", fontFamily: "monospace" }}>
      <PreviewBanner />
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {/* Tab bar */}
      <div style={{ height: "35px", background: "#252526", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "stretch", flexShrink: 0 }}>
        {/* Active tab */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 16px", background: "#1e1e1e", borderRight: "1px solid #1a1a1a", borderTop: "1px solid #0078d4", fontSize: "12px", color: "#d4d4d4", cursor: "default" }}>
          <span style={{ color: "#3dc9b0" }}>TS</span>
          checkout.ts
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#e5c07b", display: "inline-block" }} title="modified" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 14px", background: "#2d2d2d", borderRight: "1px solid #1a1a1a", fontSize: "12px", color: "#888", cursor: "pointer" }}>
          <span style={{ color: "#3dc9b0" }}>TS</span>
          payment.ts
        </div>
        {/* Analysis progress stripe */}
        {state === "analyzing" && (
          <div style={{ position: "absolute", top: "35px", left: 0, right: 0, height: "2px", background: "#1a1a1a", zIndex: 10 }}>
            <div style={{ height: "100%", background: "#0078d4", width: `${analysisProgress}%`, transition: "width 0.1s", boxShadow: "0 0 6px #0078d4" }} />
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div style={{ height: "22px", background: "#1e1e1e", borderBottom: "1px solid #252526", display: "flex", alignItems: "center", padding: "0 12px", gap: "4px", flexShrink: 0 }}>
        {["payments-service", "routes", "checkout.ts", "quickCheckout"].map((crumb, i, arr) => (
          <span key={crumb} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: i === arr.length - 1 ? "#d4d4d4" : "#888", cursor: "pointer" }}>{crumb}</span>
            {i < arr.length - 1 && <span style={{ fontSize: "10px", color: "#555" }}>›</span>}
          </span>
        ))}
      </div>

      {/* Main body: activity bar + sidebar + editor + minimap */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Activity bar */}
        <div style={{ width: "44px", background: "#333333", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "8px", gap: "4px", flexShrink: 0, borderRight: "1px solid #252526" }}>
          {ACTIVITY_ICONS.map(a => (
            <button
              key={a.id}
              title={a.title}
              onClick={() => { if (activityTab === a.id && showSidebar) { setShowSidebar(false); } else { setActivityTab(a.id); setShowSidebar(true); } }}
              style={{
                width: "34px", height: "34px", borderRadius: "4px",
                background: activityTab === a.id && showSidebar ? "rgba(255,255,255,0.1)" : "transparent",
                border: "none", color: activityTab === a.id && showSidebar ? "#d4d4d4" : "#888",
                fontSize: "16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                borderLeft: activityTab === a.id && showSidebar ? "2px solid #d4d4d4" : "2px solid transparent",
              }}
            >
              {a.icon}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {/* AI badge */}
          <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "10px", fontSize: "10px", color: "#10b981", fontWeight: 700, cursor: "pointer" }} title="Anvay AI">
            ✦
          </div>
        </div>

        {/* Sidebar panel */}
        {showSidebar && (
          <div style={{ width: "220px", background: "#252526", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {activityTab === "explorer" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>
                  Explorer
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                  {FILE_TREE.map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center", gap: "4px",
                        padding: "2px 0 2px " + (8 + f.depth * 14) + "px",
                        fontSize: "12px",
                        color: (f as { active?: boolean }).active ? "#d4d4d4" : f.isDir ? "#d4d4d4" : "#a6a6a6",
                        background: (f as { active?: boolean }).active ? "#094771" : "transparent",
                        cursor: "pointer", fontFamily: "sans-serif",
                      }}
                    >
                      {f.isDir ? (
                        <span style={{ color: "#dcb67a", fontSize: "10px" }}>{(f as { open?: boolean }).open ? "▾" : "▸"}</span>
                      ) : (
                        <span style={{ fontSize: "10px", color: "#3dc9b0", width: "12px" }}>TS</span>
                      )}
                      <span>{f.name}</span>
                      {(f as { modified?: boolean }).modified && (
                        <span style={{ marginLeft: "auto", paddingRight: "8px", width: "6px", height: "6px", borderRadius: "50%", background: "#e5c07b", display: "inline-block" }} />
                      )}
                    </div>
                  ))}
                </div>
                {/* Test panel in sidebar */}
                <div style={{ borderTop: "1px solid #1a1a1a" }}>
                  <div style={{ padding: "6px 12px 4px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif" }}>
                    Testing
                  </div>
                  {TEST_PLAN.map(tc => {
                    const result = testResults[tc.id];
                    const isRunning = activeTest === tc.id;
                    return (
                      <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "2px 12px" }}>
                        <span style={{ fontSize: "10px", color: isRunning ? "#0078d4" : result === "pass" ? "#10b981" : result === "fail" ? "#f44747" : "#555", width: "10px" }}>
                          {isRunning ? "▶" : result === "pass" ? "✓" : result === "fail" ? "✗" : "○"}
                        </span>
                        <span style={{ fontSize: "10px", fontFamily: "sans-serif", color: isRunning ? "#d4d4d4" : result ? (result === "pass" ? "#888" : "#f44747") : "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {tc.id}
                        </span>
                        {tc.generated && !result && <span style={{ fontSize: "8px", color: "#c678dd", marginLeft: "auto", flexShrink: 0 }}>AI</span>}
                      </div>
                    );
                  })}
                  <div style={{ height: "8px" }} />
                </div>
              </>
            )}

            {activityTab === "git" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>
                  Source Control
                </div>
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "sans-serif", marginBottom: "8px" }}>
                    feat/quick-checkout
                  </div>
                  {["M  routes/checkout.ts", "A  utils/idempotency.ts"].map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: "6px", padding: "3px 0", fontSize: "11px", fontFamily: "sans-serif" }}>
                      <span style={{ color: f.startsWith("M") ? "#e5c07b" : "#10b981", width: "12px" }}>{f[0]}</span>
                      <span style={{ color: "#a6a6a6" }}>{f.slice(3)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: "12px" }}>
                    <input placeholder="Commit message" style={{ width: "100%", background: "#3c3c3c", border: "1px solid #555", color: "#d4d4d4", fontSize: "11px", padding: "5px 8px", borderRadius: "3px", outline: "none", boxSizing: "border-box", fontFamily: "sans-serif" }} />
                    <button style={{ marginTop: "6px", width: "100%", background: "#0e639c", border: "none", color: "#fff", fontSize: "11px", padding: "5px", borderRadius: "3px", cursor: "pointer", fontFamily: "sans-serif" }}>
                      Commit to feat/quick-checkout
                    </button>
                  </div>
                </div>
              </>
            )}

            {activityTab === "search" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>
                  Search
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <input placeholder="Search" style={{ width: "100%", background: "#3c3c3c", border: "1px solid #555", color: "#d4d4d4", fontSize: "12px", padding: "5px 8px", borderRadius: "3px", outline: "none", boxSizing: "border-box" }} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Editor + right review panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Code area + minimap */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Code */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", position: "relative" }}>
              <div style={{ padding: "8px 0", minWidth: "520px" }}>
                {SYNTAX.map((tokens, idx) => {
                  const lineNum = idx + 1;
                  const finding = FINDINGS.find(f => f.line === lineNum);
                  const isActive = activeFinding === lineNum;
                  const showFinding = finding && showFindings;
                  return (
                    <div key={lineNum}>
                      <div
                        onClick={() => finding && showFindings && setActiveFinding(isActive ? null : lineNum)}
                        style={{
                          display: "flex", alignItems: "center", minHeight: "19px",
                          background: isActive ? "rgba(255,255,255,0.04)" : showFinding ? (finding.severity === "error" ? "rgba(244,71,71,0.06)" : "rgba(229,192,123,0.06)") : "transparent",
                          cursor: finding && showFindings ? "pointer" : "text",
                        }}
                      >
                        {/* Line number */}
                        <span style={{ width: "44px", textAlign: "right", paddingRight: "14px", fontSize: "12px", color: "#858585", flexShrink: 0, userSelect: "none", lineHeight: "19px" }}>
                          {lineNum}
                        </span>
                        {/* Gutter */}
                        <span style={{ width: "18px", flexShrink: 0, textAlign: "center" }}>
                          {showFinding && (
                            <span style={{ fontSize: "11px", color: finding.severity === "error" ? "#f44747" : "#cca700" }}>
                              {finding.severity === "error" ? "●" : "●"}
                            </span>
                          )}
                        </span>
                        {/* Syntax tokens */}
                        <span style={{ fontSize: "13px", lineHeight: "19px" }}>
                          {tokens.map((t, ti) => (
                            <span key={ti} style={{ color: t.color }}>{t.text}</span>
                          ))}
                        </span>
                        {/* Inline finding hint */}
                        {showFinding && (
                          <span style={{ marginLeft: "20px", fontSize: "11px", fontFamily: "sans-serif", color: finding.severity === "error" ? "#f44747" : "#cca700", opacity: 0.9, flexShrink: 0 }}>
                            {finding.title}
                          </span>
                        )}
                      </div>
                      {/* Expanded finding */}
                      {isActive && finding && (
                        <div style={{ margin: "2px 62px 6px", background: "#252526", border: `1px solid ${finding.severity === "error" ? "#f4474766" : "#cca70066"}`, borderRadius: "4px", padding: "10px 12px", fontSize: "11px", fontFamily: "sans-serif" }}>
                          <div style={{ color: finding.severity === "error" ? "#f44747" : "#cca700", fontWeight: 600, marginBottom: "5px" }}>{finding.title}</div>
                          <div style={{ color: "#9d9d9d", lineHeight: "1.5", marginBottom: "8px" }}>{finding.body}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.2)", borderRadius: "3px", padding: "5px 8px" }}>
                            <span style={{ color: "#c586c0", fontSize: "10px" }}>✦ Test generated:</span>
                            <code style={{ fontSize: "11px", color: "#ce9178" }}>{finding.test}</code>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Cursor blink on last writing line */}
                {state === "writing" && (
                  <div style={{ display: "flex", alignItems: "center", minHeight: "19px", paddingLeft: "62px" }}>
                    <span style={{ display: "inline-block", width: "1px", height: "14px", background: "#d4d4d4", animation: "blink 1.2s step-end infinite" }} />
                  </div>
                )}
              </div>
            </div>

            {/* Minimap */}
            <div style={{ width: "60px", background: "#1e1e1e", borderLeft: "1px solid #252526", flexShrink: 0, opacity: 0.4, overflow: "hidden" }}>
              {SYNTAX.map((tokens, i) => (
                <div key={i} style={{ height: "3px", display: "flex", alignItems: "center", paddingLeft: "4px", gap: "1px" }}>
                  {tokens.slice(0, 8).map((t, ti) => (
                    <div key={ti} style={{ height: "2px", background: t.color, width: `${t.text.length * 2}px`, borderRadius: "1px", maxWidth: "24px" }} />
                  ))}
                </div>
              ))}
            </div>

            {/* Right review panel — always visible */}
            <div style={{ width: "250px", background: "#252526", borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#10b981" }}>✦</span> Anvay
                {state === "analyzing" && <span style={{ marginLeft: "auto", color: "#0078d4", animation: "pulse-dot 1s infinite" }}>●</span>}
              </div>

              {/* Writing state */}
              {state === "writing" && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.3 }}>✦</div>
                  <div style={{ fontSize: "12px", color: "#666", fontFamily: "sans-serif", lineHeight: "1.6" }}>
                    AI review runs on save or commit
                  </div>
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "8px", fontFamily: "sans-serif" }}>
                    Finds issues · generates tests · gates deploy
                  </div>
                  <button
                    onClick={() => { setState("analyzing"); setAnalysisProgress(0); setBottomTab("problems"); }}
                    style={{ marginTop: "16px", background: "rgba(0,120,212,0.15)", border: "1px solid rgba(0,120,212,0.4)", color: "#0078d4", padding: "6px 14px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}
                  >
                    Analyze now ✦
                  </button>
                </div>
              )}

              {/* Analyzing state — step progress */}
              {state === "analyzing" && (
                <div style={{ padding: "14px 14px", flex: 1 }}>
                  <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "12px" }}>Analyzing diff…</div>
                  {[
                    "Reading changed routes",
                    "Checking input validation",
                    "Analyzing race conditions",
                    "Generating test cases",
                  ].map((step, i) => {
                    const done = analysisProgress > (i + 1) * 25;
                    const active = analysisProgress > i * 25 && !done;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", opacity: analysisProgress > i * 25 ? 1 : 0.25, transition: "opacity 0.3s" }}>
                        <span style={{ fontSize: "11px", color: done ? "#10b981" : active ? "#0078d4" : "#555", width: "12px", flexShrink: 0 }}>
                          {done ? "✓" : active ? "▶" : "○"}
                        </span>
                        <span style={{ fontSize: "11px", color: done ? "#888" : active ? "#d4d4d4" : "#666", fontFamily: "sans-serif" }}>{step}</span>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: "8px", height: "2px", background: "#3c3c3c", borderRadius: "1px" }}>
                    <div style={{ width: `${analysisProgress}%`, height: "100%", background: "#0078d4", borderRadius: "1px", transition: "width 0.1s" }} />
                  </div>
                </div>
              )}

              {/* Gate / Running / Done — full panel */}
              {showFindings && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* PR info */}
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                    <div style={{ fontSize: "11px", color: "#d4d4d4", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "3px" }}>feat: quick checkout v2</div>
                    <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif" }}>main ← feat/quick-checkout · +47 −12</div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "5px" }}>
                      <span style={{ fontSize: "10px", color: "#f44747" }}>● {errorCount}</span>
                      <span style={{ fontSize: "10px", color: "#cca700" }}>▲ {warnCount}</span>
                      <span style={{ fontSize: "10px", color: "#c586c0" }}>✦ 4 AI tests</span>
                    </div>
                  </div>

                  {/* Findings */}
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                    <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", marginBottom: "5px" }}>Review</div>
                    {FINDINGS.map(f => (
                      <div
                        key={f.line}
                        onClick={() => setActiveFinding(activeFinding === f.line ? null : f.line)}
                        style={{ padding: "5px 7px", borderRadius: "3px", marginBottom: "3px", cursor: "pointer", background: activeFinding === f.line ? "#3c3c3c" : "transparent", display: "flex", gap: "6px", alignItems: "flex-start" }}
                      >
                        <span style={{ fontSize: "10px", color: f.severity === "error" ? "#f44747" : "#cca700", flexShrink: 0, marginTop: "1px" }}>●</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "11px", color: "#d4d4d4", fontFamily: "sans-serif" }}>{f.title}</div>
                          <div style={{ fontSize: "10px", color: "#555", fontFamily: "sans-serif" }}>checkout.ts:{f.line}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Test plan — the key panel the user wants back */}
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid #1a1a1a", flex: 1, overflowY: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif" }}>Test Plan</span>
                      <span style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif" }}>
                        {state === "done" ? `${passCount}✓ ${failCount > 0 ? failCount + "✗" : ""}` : `${TEST_PLAN.length} cases`}
                      </span>
                    </div>
                    {TEST_PLAN.map(tc => {
                      const result = testResults[tc.id];
                      const isRunning = activeTest === tc.id;
                      return (
                        <div key={tc.id} style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "6px", padding: "4px 6px", borderRadius: "3px", background: isRunning ? "rgba(0,120,212,0.1)" : result === "fail" ? "rgba(244,71,71,0.06)" : "transparent" }}>
                          <span style={{ fontSize: "11px", color: isRunning ? "#0078d4" : result === "pass" ? "#10b981" : result === "fail" ? "#f44747" : "#555", flexShrink: 0, marginTop: "1px", width: "12px" }}>
                            {isRunning ? "▶" : result === "pass" ? "✓" : result === "fail" ? "✗" : "○"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>{tc.id}</div>
                            <div style={{ fontSize: "11px", color: isRunning ? "#d4d4d4" : result === "fail" ? "#f44747" : result === "pass" ? "#888" : "#666", fontFamily: "sans-serif", lineHeight: "1.3", marginTop: "1px" }}>
                              {tc.label}
                            </div>
                          </div>
                          {tc.generated && (
                            <span style={{ fontSize: "9px", color: "#c586c0", flexShrink: 0, marginTop: "2px", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.2)", borderRadius: "2px", padding: "0 3px" }}>
                              AI
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Confidence */}
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif" }}>Confidence</span>
                      <span style={{ fontSize: "11px", color: "#cca700", fontFamily: "monospace", fontWeight: 700 }}>0.72</span>
                    </div>
                    <div style={{ height: "3px", background: "#3c3c3c", borderRadius: "2px" }}>
                      <div style={{ width: "72%", height: "100%", background: "#cca700", borderRadius: "2px" }} />
                    </div>
                    <div style={{ fontSize: "10px", color: "#555", marginTop: "4px", fontFamily: "sans-serif" }}>
                      Below 0.90 — human gate required
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ padding: "10px 12px", flexShrink: 0 }}>
                    {state === "gate" && (
                      <>
                        <button
                          onClick={() => { setState("running"); setRunIndex(0); setTestResults({}); setBottomTab("tests"); }}
                          style={{ width: "100%", background: "#0e639c", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "5px" }}
                        >
                          Approve & Run Tests
                        </button>
                        <button style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}>
                          Request Changes
                        </button>
                      </>
                    )}
                    {state === "running" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#0078d4", fontFamily: "sans-serif" }}>
                        <span style={{ animation: "pulse-dot 0.8s infinite" }}>●</span>
                        Running {activeTest ?? "…"}
                      </div>
                    )}
                    {state === "done" && (
                      <>
                        {failCount === 0 ? (
                          <button style={{ width: "100%", background: "#16825d", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "sans-serif" }}>
                            Deploy to staging →
                          </button>
                        ) : (
                          <>
                            <div style={{ fontSize: "11px", color: "#f44747", fontFamily: "sans-serif", background: "rgba(244,71,71,0.08)", border: "1px solid rgba(244,71,71,0.2)", borderRadius: "3px", padding: "7px 10px", marginBottom: "6px" }}>
                              ✗ Blocked — TC-005 failing
                            </div>
                            <button style={{ width: "100%", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.3)", color: "#c586c0", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", marginBottom: "5px" }}>
                              ✦ Explain failure
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setState("writing"); setTestResults({}); setActiveFinding(null); setRunIndex(0); }}
                          style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}
                        >
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom panel: Problems / Tests / Terminal */}
          <div style={{ height: bottomHeight + "px", background: "#1e1e1e", borderTop: "1px solid #252526", flexShrink: 0, display: "flex", flexDirection: "column" }}>
            {/* Panel tabs */}
            <div style={{ height: "28px", background: "#252526", display: "flex", alignItems: "stretch", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
              {(["problems", "tests", "terminal"] as BottomTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  style={{
                    padding: "0 14px", background: bottomTab === tab ? "#1e1e1e" : "transparent",
                    border: "none", borderTop: bottomTab === tab ? "1px solid #0078d4" : "1px solid transparent",
                    color: bottomTab === tab ? "#d4d4d4" : "#888",
                    fontSize: "11px", cursor: "pointer", fontFamily: "sans-serif", textTransform: "capitalize",
                    display: "flex", alignItems: "center", gap: "5px",
                  }}
                >
                  {tab === "problems" && errorCount + warnCount > 0 && (
                    <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: errorCount > 0 ? "#f44747" : "#cca700", fontSize: "8px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                      {errorCount + warnCount}
                    </span>
                  )}
                  {tab === "tests" && (passCount > 0 || failCount > 0) && (
                    <span style={{ fontSize: "10px", color: failCount > 0 ? "#f44747" : "#10b981" }}>
                      {failCount > 0 ? `✗ ${failCount}` : `✓ ${passCount}`}
                    </span>
                  )}
                  {tab}
                </button>
              ))}
              {/* Panel resize handle — cosmetic */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", paddingRight: "10px" }}>
                <button onClick={() => setBottomHeight(h => h === 180 ? 300 : 180)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "12px" }}>
                  {bottomHeight > 180 ? "▾" : "▴"}
                </button>
                <button onClick={() => setBottomHeight(0)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "14px" }}>
                  ×
                </button>
              </div>
            </div>

            {/* Panel content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 14px" }}>
              {bottomTab === "problems" && (
                <>
                  {!showFindings && (
                    <div style={{ fontSize: "11px", color: "#666", fontFamily: "sans-serif", padding: "8px 0" }}>
                      No problems detected. Click &quot;Analyze now&quot; to run AI review.
                    </div>
                  )}
                  {showFindings && FINDINGS.map(f => (
                    <div
                      key={f.line}
                      onClick={() => setActiveFinding(activeFinding === f.line ? null : f.line)}
                      style={{ display: "flex", gap: "8px", padding: "4px 0", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", alignItems: "flex-start" }}
                    >
                      <span style={{ color: f.severity === "error" ? "#f44747" : "#cca700", flexShrink: 0 }}>●</span>
                      <span style={{ color: "#d4d4d4" }}>{f.title}</span>
                      <span style={{ color: "#666" }}>checkout.ts:{f.line}</span>
                      <span style={{ color: "#555", marginLeft: "auto" }}>Anvay</span>
                    </div>
                  ))}
                </>
              )}
              {bottomTab === "tests" && (
                <div>
                  {TEST_PLAN.map(tc => {
                    const result = testResults[tc.id];
                    const isRunning = activeTest === tc.id;
                    return (
                      <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", fontSize: "11px", fontFamily: "sans-serif" }}>
                        <span style={{ color: isRunning ? "#0078d4" : result === "pass" ? "#10b981" : result === "fail" ? "#f44747" : "#555", width: "12px" }}>
                          {isRunning ? "▶" : result === "pass" ? "✓" : result === "fail" ? "✗" : "○"}
                        </span>
                        <span style={{ color: result === "fail" ? "#f44747" : "#888" }}>{tc.id}</span>
                        <span style={{ color: "#666" }}>—</span>
                        <span style={{ color: result === "fail" ? "#f44747" : result === "pass" ? "#888" : "#555", flex: 1 }}>{tc.label}</span>
                        {tc.generated && <span style={{ fontSize: "9px", color: "#c586c0" }}>AI</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {bottomTab === "terminal" && (
                <div>
                  {(state === "done" ? TERMINAL_LINES : TERMINAL_LINES.slice(0, 3)).map((line, i) => (
                    <div key={i} style={{ fontSize: "12px", color: line.color || "#d4d4d4", lineHeight: "1.5", minHeight: "18px" }}>
                      {line.text || " "}
                    </div>
                  ))}
                  {state !== "done" && (
                    <span style={{ display: "inline-block", width: "6px", height: "13px", background: "#d4d4d4", animation: "blink 1.2s step-end infinite" }} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* VS Code status bar */}
      <div style={{ height: "22px", background: "#007acc", display: "flex", alignItems: "center", padding: "0 10px", gap: "14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#fff" }}>
          <span>⬡</span>
          <span>feat/quick-checkout</span>
        </div>
        {showFindings && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#fff" }}>
            <span>● {errorCount} errors</span>
            <span>▲ {warnCount} warnings</span>
          </div>
        )}
        {(state === "running" || state === "done") && (
          <div style={{ fontSize: "11px", color: "#fff" }}>
            Tests: {passCount} passed{failCount > 0 ? `, ${failCount} failed` : ""}
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", fontSize: "11px", color: "#ffffffb0" }}>
          <span>TypeScript</span>
          <span>UTF-8</span>
          <span>Ln 14, Col 42</span>
          <span style={{ color: "#fff", background: "rgba(255,255,255,0.15)", padding: "0 6px", borderRadius: "2px" }}>
            ✦ Anvay
          </span>
        </div>
        {/* Bottom trigger button only in writing state (status bar integrated) */}
        {state === "writing" && (
          <button
            onClick={() => { setState("analyzing"); setAnalysisProgress(0); setBottomTab("problems"); }}
            style={{ marginLeft: "8px", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", padding: "1px 8px", borderRadius: "2px", cursor: "pointer", fontSize: "11px" }}
          >
            Analyze ✦
          </button>
        )}
      </div>
    </div>
  );
}
