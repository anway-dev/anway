"use client";
import { useState, useEffect } from "react";

type EditorState = "writing" | "analyzing" | "gate" | "running" | "done";

const CODE_LINES = [
  { n: 1,  code: `import { db } from '../lib/db'`,                                   indent: 0 },
  { n: 2,  code: `import { paymentService } from '../services/payment'`,             indent: 0 },
  { n: 3,  code: ``,                                                                  indent: 0 },
  { n: 4,  code: `export async function quickCheckout(req, res) {`,                  indent: 0 },
  { n: 5,  code: `  const { userId, methodId, amount, currency } = req.body`,        indent: 1 },
  { n: 6,  code: ``,                                                                  indent: 0 },
  { n: 7,  code: `  // fetch saved payment method`,                                  indent: 1, comment: true },
  { n: 8,  code: `  const method = await db.paymentMethods.findOne(methodId)`,       indent: 1, finding: "warn" },
  { n: 9,  code: `  if (!method || method.userId !== userId) {`,                     indent: 1 },
  { n: 10, code: `    return res.status(403).json({ error: 'Forbidden' })`,          indent: 2 },
  { n: 11, code: `  }`,                                                               indent: 1 },
  { n: 12, code: ``,                                                                  indent: 0 },
  { n: 13, code: `  // create payment`,                                              indent: 1, comment: true },
  { n: 14, code: `  const payment = await paymentService.create({`,                  indent: 1, finding: "risk" },
  { n: 15, code: `    userId, methodId, amount, currency`,                            indent: 2 },
  { n: 16, code: `  })`,                                                              indent: 1 },
  { n: 17, code: ``,                                                                  indent: 0 },
  { n: 18, code: `  return res.status(201).json(payment)`,                           indent: 1 },
  { n: 19, code: `}`,                                                                 indent: 0 },
];

const FINDINGS = [
  { line: 8,  severity: "warn",  title: "No input validation",    body: "amount and currency are passed directly to paymentService.create() without validation. Negative amounts and unsupported currencies will cause downstream errors.",  test: "POST /checkout { amount: -100 } → expect 422" },
  { line: 14, severity: "risk",  title: "Race condition possible", body: "No idempotency check before creating payment. Concurrent requests with the same methodId could create duplicate charges.",  test: "Concurrent POST with same body → expect same paymentId" },
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

export function EditorView() {
  const [state, setState] = useState<EditorState>("writing");
  const [activeFinding, setActiveFinding] = useState<number | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [testResults, setTestResults] = useState<Record<string, "pass" | "fail" | "running">>({});
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [runIndex, setRunIndex] = useState(0);

  // Analysis animation
  useEffect(() => {
    if (state !== "analyzing") return;
    const t = setInterval(() => {
      setAnalysisProgress((p) => {
        if (p >= 100) { clearInterval(t); setState("gate"); return 100; }
        return p + 8;
      });
    }, 80);
    return () => clearInterval(t);
  }, [state]);

  // Test run animation
  useEffect(() => {
    if (state !== "running") return;
    if (runIndex >= RUN_SEQUENCE.length) { setState("done"); return; }
    const { id, result, ms } = RUN_SEQUENCE[runIndex];
    setActiveTest(id);
    const t = setTimeout(() => {
      setTestResults((prev) => ({ ...prev, [id]: result }));
      setActiveTest(null);
      setRunIndex((i) => i + 1);
    }, Math.min(ms, 600));
    return () => clearTimeout(t);
  }, [state, runIndex]);

  const passCount = Object.values(testResults).filter((r) => r === "pass").length;
  const failCount = Object.values(testResults).filter((r) => r === "fail").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#080808" }}>

      {/* Title bar */}
      <div style={{ height: "38px", background: "#0e0e0e", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", padding: "0 16px", gap: "8px", flexShrink: 0 }}>
        <span style={{ fontSize: "11px", color: "#555" }}>payments-service</span>
        <span style={{ color: "#333" }}>›</span>
        <span style={{ fontSize: "11px", color: "#555" }}>src</span>
        <span style={{ color: "#333" }}>›</span>
        <span style={{ fontSize: "11px", color: "#d1d5db", fontWeight: 600 }}>checkout.ts</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Confidence meter */}
          {(state === "gate" || state === "running" || state === "done") && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "10px", color: "#555" }}>confidence</span>
              <div style={{ display: "flex", gap: "2px" }}>
                {[1,2,3,4,5].map((i) => (
                  <div key={i} style={{ width: "12px", height: "4px", borderRadius: "2px", background: i <= 3 ? "#f59e0b" : "#2a2a2a" }} />
                ))}
              </div>
              <span style={{ fontSize: "10px", color: "#f59e0b" }}>0.72</span>
            </div>
          )}
          {/* PR badge */}
          <div style={{ background: "#1a2030", border: "1px solid #2a3a50", padding: "3px 8px", borderRadius: "4px", fontSize: "10px", color: "#3b82f6" }}>
            PR #42
          </div>
          {/* State indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: state === "running" ? "#3b82f6" : state === "done" ? (failCount > 0 ? "#f97316" : "#10b981") : state === "gate" ? "#f59e0b" : "#555", animation: state === "running" || state === "analyzing" ? "pulse-dot 1s infinite" : "none" }} />
            <span style={{ fontSize: "10px", color: "#888" }}>
              {state === "writing" ? "ready" : state === "analyzing" ? "analyzing…" : state === "gate" ? "needs review" : state === "running" ? "testing…" : failCount > 0 ? "1 failure" : "all passing"}
            </span>
          </div>
        </div>
      </div>

      {/* Analysis progress bar */}
      {state === "analyzing" && (
        <div style={{ height: "2px", background: "#1a1a1a", flexShrink: 0 }}>
          <div style={{ height: "100%", background: "#3b82f6", width: `${analysisProgress}%`, transition: "width 0.1s", boxShadow: "0 0 8px #3b82f6" }} />
        </div>
      )}

      {/* Main area: sidebar + editor + right panel */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* File sidebar */}
        <div style={{ width: "180px", background: "#0a0a0a", borderRight: "1px solid #111", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "8px 12px", fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>Explorer</div>
          <div style={{ padding: "2px 0" }}>
            {["routes /", " checkout.ts ●", " payment.ts", " refund.ts", "services /", " payment.ts", "utils /", " validation.ts"].map((f, i) => {
              const isActive = f.includes("checkout");
              const isDir = f.endsWith("/");
              return (
                <div key={i} style={{ padding: "3px 12px", fontSize: "11px", color: isActive ? "#e5e5e5" : isDir ? "#555" : "#888", background: isActive ? "#1a2a1a" : "transparent", borderLeft: isActive ? "2px solid #10b981" : "2px solid transparent", cursor: "pointer", fontFamily: isDir ? "sans-serif" : "monospace" }}>
                  {f}
                </div>
              );
            })}
          </div>

          <div style={{ padding: "12px 12px 6px", fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tests</div>
          {TEST_PLAN.map((tc) => {
            const result = testResults[tc.id];
            const isRunning = activeTest === tc.id;
            return (
              <div key={tc.id} style={{ padding: "3px 12px", display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ fontSize: "10px", color: isRunning ? "#3b82f6" : result === "pass" ? "#10b981" : result === "fail" ? "#ef4444" : "#333" }}>
                  {isRunning ? "▶" : result === "pass" ? "✓" : result === "fail" ? "✗" : "○"}
                </span>
                <span style={{ fontSize: "10px", color: isRunning ? "#e5e5e5" : result ? (result === "pass" ? "#10b981" : "#ef4444") : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tc.id}
                </span>
                {tc.generated && !result && (
                  <span style={{ fontSize: "8px", color: "#8b5cf6", marginLeft: "auto", flexShrink: 0 }}>AI</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, overflow: "auto", position: "relative", fontFamily: "monospace" }}>
          {/* Line numbers + code */}
          <div style={{ padding: "16px 0", minWidth: "500px" }}>
            {CODE_LINES.map((line) => {
              const finding = FINDINGS.find((f) => f.line === line.n);
              const isActive = activeFinding === line.n;
              return (
                <div key={line.n}>
                  <div
                    style={{ display: "flex", alignItems: "center", minHeight: "22px", background: isActive ? "rgba(245,158,11,0.08)" : (finding && (state === "gate" || state === "running" || state === "done")) ? (finding.severity === "warn" ? "rgba(249,115,22,0.05)" : "rgba(239,68,68,0.05)") : "transparent", cursor: finding ? "pointer" : "default" }}
                    onClick={() => finding && setActiveFinding(isActive ? null : line.n)}
                  >
                    {/* Line number */}
                    <span style={{ width: "40px", textAlign: "right", paddingRight: "16px", fontSize: "12px", color: "#333", flexShrink: 0, userSelect: "none" }}>
                      {line.n}
                    </span>

                    {/* Gutter indicator */}
                    <span style={{ width: "16px", flexShrink: 0 }}>
                      {finding && (state === "gate" || state === "running" || state === "done") && (
                        <span style={{ fontSize: "12px", color: finding.severity === "warn" ? "#f97316" : "#ef4444" }}>
                          {finding.severity === "warn" ? "⚠" : "⚡"}
                        </span>
                      )}
                    </span>

                    {/* Code */}
                    <span style={{ fontSize: "12px", lineHeight: "22px", color: line.comment ? "#555" : "#d1d5db", paddingLeft: "4px" }}>
                      {line.code}
                    </span>

                    {/* Inline finding pill */}
                    {finding && (state === "gate" || state === "running" || state === "done") && (
                      <span style={{ marginLeft: "16px", fontSize: "10px", color: finding.severity === "warn" ? "#f97316" : "#ef4444", background: finding.severity === "warn" ? "rgba(249,115,22,0.12)" : "rgba(239,68,68,0.12)", padding: "1px 6px", borderRadius: "3px", flexShrink: 0 }}>
                        {finding.title}
                      </span>
                    )}
                  </div>

                  {/* Expanded finding */}
                  {isActive && finding && (
                    <div style={{ margin: "4px 56px 8px", background: "#111", border: `1px solid ${finding.severity === "warn" ? "rgba(249,115,22,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: "8px", padding: "12px", fontSize: "11px" }}>
                      <div style={{ color: finding.severity === "warn" ? "#f97316" : "#ef4444", fontWeight: 700, marginBottom: "6px" }}>{finding.title}</div>
                      <div style={{ color: "#888", lineHeight: "1.6", marginBottom: "10px" }}>{finding.body}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: "4px" }}>
                        <span style={{ fontSize: "10px", color: "#8b5cf6" }}>✦ Test added:</span>
                        <span style={{ fontSize: "10px", color: "#d1d5db", fontFamily: "monospace" }}>{finding.test}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right context panel */}
        <div style={{ width: "260px", background: "#0a0a0a", borderLeft: "1px solid #111", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>

          {/* PR info */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #111" }}>
            <div style={{ fontSize: "10px", color: "#444", marginBottom: "6px" }}>PULL REQUEST</div>
            <div style={{ fontSize: "12px", color: "#e5e5e5", fontWeight: 600, marginBottom: "4px" }}>feat: quick checkout v2</div>
            <div style={{ fontSize: "10px", color: "#888" }}>main ← feat/quick-checkout</div>
            <div style={{ fontSize: "10px", color: "#555", marginTop: "4px" }}>+47 −12 lines · 2 files</div>
          </div>

          {/* Review findings */}
          {(state === "gate" || state === "running" || state === "done") && (
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #111" }}>
              <div style={{ fontSize: "10px", color: "#444", marginBottom: "8px" }}>REVIEW</div>
              {FINDINGS.map((f) => (
                <div
                  key={f.line}
                  onClick={() => setActiveFinding(activeFinding === f.line ? null : f.line)}
                  style={{ display: "flex", gap: "8px", marginBottom: "8px", cursor: "pointer", padding: "6px 8px", background: activeFinding === f.line ? "#1a1a1a" : "transparent", borderRadius: "4px" }}
                >
                  <span style={{ fontSize: "11px", color: f.severity === "warn" ? "#f97316" : "#ef4444", flexShrink: 0 }}>
                    {f.severity === "warn" ? "⚠" : "⚡"}
                  </span>
                  <div>
                    <div style={{ fontSize: "11px", color: "#d1d5db" }}>{f.title}</div>
                    <div style={{ fontSize: "10px", color: "#555" }}>line {f.line}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Test plan */}
          {(state === "gate" || state === "running" || state === "done") && (
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #111", flex: 1, overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "10px", color: "#444" }}>TEST PLAN</span>
                <span style={{ fontSize: "10px", color: "#555" }}>{TEST_PLAN.length} cases</span>
              </div>
              {TEST_PLAN.map((tc) => {
                const result = testResults[tc.id];
                const isRunning = activeTest === tc.id;
                return (
                  <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                    <span style={{ fontSize: "11px", width: "12px", flexShrink: 0, color: isRunning ? "#3b82f6" : result === "pass" ? "#10b981" : result === "fail" ? "#ef4444" : "#333" }}>
                      {isRunning ? "▶" : result === "pass" ? "✓" : result === "fail" ? "✗" : "○"}
                    </span>
                    <span style={{ fontSize: "10px", color: isRunning ? "#e5e5e5" : result ? (result === "pass" ? "#10b981" : "#ef4444") : "#666", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tc.label}
                    </span>
                    {tc.generated && (
                      <span style={{ fontSize: "8px", color: "#8b5cf6", flexShrink: 0 }}>AI</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Writing state placeholder */}
          {state === "writing" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>✦</div>
                <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.6" }}>AI analysis runs on save or commit</div>
              </div>
            </div>
          )}

          {/* Analyzing state */}
          {state === "analyzing" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "14px" }}>
              <div style={{ fontSize: "10px", color: "#444", marginBottom: "12px" }}>ANALYZING DIFF</div>
              {["Reading changed routes…", "Checking input validation…", "Analyzing race conditions…", "Generating test cases…"].map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", opacity: analysisProgress > i * 25 ? 1 : 0.2, transition: "opacity 0.3s" }}>
                  <span style={{ fontSize: "10px", color: analysisProgress > (i + 1) * 25 ? "#10b981" : "#3b82f6" }}>
                    {analysisProgress > (i + 1) * 25 ? "✓" : "·"}
                  </span>
                  <span style={{ fontSize: "11px", color: "#888" }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          {/* Deploy + metrics (shown when done) */}
          {state === "done" && (
            <div style={{ padding: "12px 14px", borderTop: "1px solid #111" }}>
              <div style={{ fontSize: "10px", color: "#444", marginBottom: "8px" }}>DEPLOY</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: failCount > 0 ? "#ef4444" : "#10b981" }} />
                <span style={{ fontSize: "11px", color: failCount > 0 ? "#ef4444" : "#10b981" }}>
                  {failCount > 0 ? "Blocked — 1 failure" : "Ready to deploy"}
                </span>
              </div>
              {failCount === 0 && (
                <button style={{ width: "100%", background: "#10b981", border: "none", color: "#000", padding: "7px", borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>
                  Deploy to staging →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom gate / results bar */}
      <div style={{ flexShrink: 0, borderTop: "1px solid #1a1a1a", background: "#0a0a0a" }}>

        {/* Writing state: trigger button */}
        {state === "writing" && (
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "11px", color: "#555" }}>Save to trigger analysis, or</span>
            <button
              onClick={() => { setState("analyzing"); setAnalysisProgress(0); }}
              style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", color: "#3b82f6", padding: "5px 14px", borderRadius: "5px", cursor: "pointer", fontSize: "11px" }}
            >
              ✦ Analyze now
            </button>
          </div>
        )}

        {/* Analyzing */}
        {state === "analyzing" && (
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6", animation: "pulse-dot 0.8s infinite" }} />
            <span style={{ fontSize: "11px", color: "#888" }}>Reading diff and generating test plan…</span>
            <span style={{ marginLeft: "auto", fontSize: "10px", color: "#555" }}>{analysisProgress}%</span>
          </div>
        )}

        {/* Gate */}
        {state === "gate" && (
          <div style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {/* Summary */}
              <div style={{ display: "flex", gap: "12px", flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#f97316" }}>⚠ 1 warning</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#ef4444" }}>⚡ 1 risk</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ fontSize: "11px", color: "#8b5cf6" }}>✦ 4 AI-generated tests</span>
                </div>
              </div>

              {/* Gate actions */}
              <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                <button
                  style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}
                >
                  Modify
                </button>
                <button
                  onClick={() => { setState("running"); setRunIndex(0); setTestResults({}); }}
                  style={{ background: "#10b981", border: "none", color: "#000", padding: "6px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                >
                  Approve & Run →
                </button>
              </div>
            </div>
            <div style={{ marginTop: "8px", fontSize: "10px", color: "#444" }}>
              Confidence 0.72 — human gate required for this service · <span style={{ color: "#555", cursor: "pointer", textDecoration: "underline" }}>change policy</span>
            </div>
          </div>
        )}

        {/* Running */}
        {state === "running" && (
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#3b82f6", animation: "pulse-dot 0.8s infinite", flexShrink: 0 }} />
            <div style={{ display: "flex", gap: "10px", flex: 1, overflow: "hidden" }}>
              {activeTest && (
                <span style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>
                  running {activeTest}…
                </span>
              )}
              <span style={{ fontSize: "11px", color: "#10b981" }}>
                {passCount} passed
              </span>
              {failCount > 0 && <span style={{ fontSize: "11px", color: "#ef4444" }}>{failCount} failed</span>}
            </div>
            <span style={{ fontSize: "10px", color: "#555" }}>{passCount + failCount} / {TEST_PLAN.length}</span>
          </div>
        )}

        {/* Done */}
        {state === "done" && (
          <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ display: "flex", gap: "12px", flex: 1 }}>
              <span style={{ fontSize: "11px", color: "#10b981" }}>✓ {passCount} passed</span>
              {failCount > 0 && <span style={{ fontSize: "11px", color: "#ef4444" }}>✗ {failCount} failed — TC-005 concurrent requests</span>}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setState("writing"); setTestResults({}); setActiveFinding(null); setRunIndex(0); }}
                style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#555", padding: "5px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "11px" }}
              >
                Reset
              </button>
              {failCount > 0 && (
                <button style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", color: "#8b5cf6", padding: "5px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "11px" }}>
                  ✦ Explain failure
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
