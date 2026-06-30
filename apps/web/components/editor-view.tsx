"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type EditorState = "idle" | "loading" | "writing" | "analyzing" | "gate" | "running" | "done";
type BottomTab = "problems" | "tests" | "terminal";
type ActivityTab = "explorer" | "search" | "git";
type ProjectSource = "demo" | "disk" | "github" | "service";

interface ConnectedService {
  id: string;
  name: string;
  namespace: string | null;
  connectorCoordinates: Record<string, unknown>;
}

interface GitCred {
  provider: string;
  username: string | null;
  email: string | null;
  configured: boolean;
}

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
  active?: boolean;
}

interface Finding {
  line: number;
  severity: "error" | "warn" | "info";
  title: string;
  body: string;
  test: string;
}

interface TestCase {
  id: string;
  label: string;
  generated: boolean;
  status?: "queued" | "pass" | "fail" | "running";
  ms?: number;
  reason?: string;
}

interface DeployTarget {
  id: string;
  label: string;
  platform: string;
  tfEnv: string;
  connectorType: string;
  meta: Record<string, string>;
}

interface DeployState {
  phase: "idle" | "detecting" | "picking" | "planning" | "confirming" | "applying" | "done" | "error";
  lines: string[];
  exitCode?: number;
  targets?: DeployTarget[];
  selectedTarget?: DeployTarget;
}

// Demo project path — the real chaotic payments-api
const DEMO_PATH = process.env.NEXT_PUBLIC_DEMO_SERVICES_PATH ?? "/infra/demo/services/payments-api";

// ── Activity bar icons ─────────────────────────────────────────────────────────

const ACTIVITY_ICONS: { id: ActivityTab; icon: string; title: string }[] = [
  { id: "explorer", icon: "⊞", title: "Explorer" },
  { id: "search",   icon: "⊙", title: "Search" },
  { id: "git",      icon: "⬡", title: "Source Control" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function extIcon(name: string): string {
  const ext = name.split(".").pop() ?? "";
  if (["ts", "tsx"].includes(ext)) return "TS";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "JS";
  if (ext === "py") return "PY";
  if (ext === "go") return "GO";
  if (ext === "sh") return "SH";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "{}";
  if (ext === "tf") return "TF";
  if (ext === "md") return "MD";
  return "◻";
}

async function readSSE(
  url: string,
  init: RequestInit,
  onEvent: (data: object) => void,
): Promise<void> {
  const resp = await fetch(url, init);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data: ")) {
        try { onEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
      }
    }
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EditorView() {
  // Project source
  const [source, setSource] = useState<ProjectSource>("demo");
  const [diskPath, setDiskPath]     = useState("");
  const [githubUrl, setGithubUrl]   = useState("");
  const [connectedServices, setConnectedServices] = useState<ConnectedService[]>([]);
  const [selectedService, setSelectedService] = useState<ConnectedService | null>(null);

  // Git credentials
  const [gitCreds, setGitCreds] = useState<GitCred[]>([]);
  const [showGitCredForm, setShowGitCredForm] = useState(false);
  const [gitCredProvider, setGitCredProvider] = useState("github");
  const [gitCredToken, setGitCredToken] = useState("");
  const [gitCredUsername, setGitCredUsername] = useState("");
  const [gitCredEmail, setGitCredEmail] = useState("");
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  // File tree
  const [fileTree, setFileTree]     = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);

  // File content
  const [fileContent, setFileContent] = useState("");
  const [filename, setFilename]         = useState("");
  const [language, setLanguage]         = useState("javascript");

  // Analysis
  const [state, setState]             = useState<EditorState>("idle");
  const [analyzeSteps, setAnalyzeSteps] = useState<{ label: string; done: boolean; active: boolean }[]>([]);
  const [findings, setFindings]       = useState<Finding[]>([]);
  const [testPlan, setTestPlan]       = useState<TestCase[]>([]);
  const [confidence, setConfidence]   = useState<number | null>(null);
  const [analysisSummary, setSummary] = useState("");
  const [activeFinding, setActiveFinding] = useState<number | null>(null);

  // Test execution
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [generatedTestCode, setGeneratedTestCode] = useState("");

  // Deploy
  const [deploy, setDeploy] = useState<DeployState>({ phase: "idle", lines: [] });
  const [gateId, setGateId] = useState<string | null>(null);

  // UI
  const [bottomTab, setBottomTab]   = useState<BottomTab>("problems");
  const [activityTab, setActivityTab] = useState<ActivityTab>("explorer");
  const [showSidebar, setShowSidebar] = useState(true);
  const [bottomHeight, setBottomHeight] = useState(180);

  const abortRef = useRef<AbortController | null>(null);

  const passCount = testPlan.filter(t => t.status === "pass").length;
  const failCount = testPlan.filter(t => t.status === "fail").length;
  const errorCount = findings.filter(f => f.severity === "error").length;
  const warnCount  = findings.filter(f => f.severity === "warn").length;
  const showFindings = ["gate","running","done"].includes(state);

  // ── Load file tree ──────────────────────────────────────────────────────────

  const loadTree = useCallback(async (rootPath: string) => {
    try {
      const resp = await fetch(`/api/editor/files?path=${encodeURIComponent(rootPath)}`);
      if (!resp.ok) return;
      const tree: FileEntry[] = await resp.json();
      setFileTree(tree);
    } catch { /* ignore */ }
  }, []);

  // ── Load file content ───────────────────────────────────────────────────────

  const loadFile = useCallback(async (filePath: string) => {
    setState("loading");
    setFindings([]);
    setTestPlan([]);
    setConfidence(null);
    setSummary("");
    setActiveFinding(null);
    setTerminalLines([]);
    setGeneratedTestCode("");
    setDeploy({ phase: "idle", lines: [] });

    try {
      const resp = await fetch(`/api/editor/file?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) { setState("writing"); return; }
      const data = await resp.json();
      setFileContent(data.content ?? "");
      setFilename(data.filename ?? "");
      setLanguage(data.language ?? "plaintext");
      setState("writing");
    } catch {
      setState("writing");
    }
  }, []);

  // ── Load demo + connected services + git creds on mount ────────────────────

  useEffect(() => {
    loadDemoProject();
    fetch("/api/editor/services").then(r => r.ok ? r.json() : []).then((s: ConnectedService[]) => setConnectedServices(s)).catch(() => {});
    fetch("/api/user/git-credentials").then(r => r.ok ? r.json() : []).then((c: GitCred[]) => setGitCreds(c)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDemoProject() {
    setState("loading");
    // Load demo file tree
    const demoRoot = DEMO_PATH;
    await loadTree(demoRoot);

    // Load the main server.js
    const mainFile = `${demoRoot}/server.js`;
    const resp = await fetch(`/api/editor/file?path=${encodeURIComponent(mainFile)}`).catch(() => null);

    if (resp?.ok) {
      const data = await resp.json();
      setFileContent(data.content ?? "");
      setFilename(data.filename ?? "server.js");
      setLanguage(data.language ?? "javascript");
      setActiveFile({ name: "server.js", path: mainFile, isDir: false, depth: 1, active: true });
    } else {
      // Fallback to demo code if path not accessible
      setFileContent(DEMO_FALLBACK_CODE);
      setFilename("payments-api/server.js");
      setLanguage("javascript");
    }
    setState("writing");
  }

  // ── Project source switch ───────────────────────────────────────────────────

  async function applySource() {
    setShowSourcePicker(false);
    setFindings([]);
    setTestPlan([]);
    setState("loading");

    if (source === "demo") {
      await loadDemoProject();
      return;
    }

    if (source === "disk" && diskPath) {
      await loadTree(diskPath);
      // try to load package.json or main file
      const mainGuesses = ["index.ts", "index.js", "src/index.ts", "src/index.js", "main.ts", "main.go"];
      for (const guess of mainGuesses) {
        const tryPath = `${diskPath}/${guess}`;
        const resp = await fetch(`/api/editor/file?path=${encodeURIComponent(tryPath)}`).catch(() => null);
        if (resp?.ok) {
          await loadFile(tryPath);
          return;
        }
      }
      setState("writing");
      return;
    }

    if (source === "service" && selectedService) {
      // Try conventional paths: services/{name}/, apps/{name}/
      const candidates = [
        `/services/${selectedService.name}`,
        `/apps/${selectedService.name}`,
        `/apps/${selectedService.name.replace(/-service$/, '')}`,
      ];
      const editorRoot = process.env.NEXT_PUBLIC_EDITOR_ROOT ?? "";
      for (const rel of candidates) {
        const tryPath = `${editorRoot}${rel}`;
        const resp = await fetch(`/api/editor/files?path=${encodeURIComponent(tryPath)}`).catch(() => null);
        if (resp?.ok) {
          await loadTree(tryPath);
          // Load entry point
          const entryResp = await fetch(`/api/editor/file?path=${encodeURIComponent(`${tryPath}/index.ts`)}`).catch(() => null)
            ?? await fetch(`/api/editor/file?path=${encodeURIComponent(`${tryPath}/src/index.ts`)}`).catch(() => null);
          if (entryResp?.ok) {
            const d = await entryResp.json();
            setFileContent(d.content ?? ""); setFilename(d.filename ?? "index.ts"); setLanguage(d.language ?? "typescript");
          }
          setState("writing"); return;
        }
      }
      setState("writing"); return;
    }

    if (source === "github" && githubUrl) {
      // Clone via gateway — for now show message
      setFileContent(`# GitHub import\n# URL: ${githubUrl}\n# Clone support coming — connect GitHub connector first.`);
      setFilename("README");
      setLanguage("markdown");
      setState("writing");
    }
  }

  // ── Run analysis ──────────────────────────────────────────────────────────

  async function runAnalysis() {
    if (!fileContent || !filename) return;

    setState("analyzing");
    setFindings([]);
    setTestPlan([]);
    setConfidence(null);
    setSummary("");
    setAnalyzeSteps([
      { label: "Reading file structure",    done: false, active: true  },
      { label: "Checking security issues",  done: false, active: false },
      { label: "Analyzing race conditions", done: false, active: false },
      { label: "Generating test cases",     done: false, active: false },
    ]);
    setBottomTab("problems");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    let stepIdx = 0;

    await readSSE(
      "/api/editor/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileContent, filename, language }),
        signal: abortRef.current.signal,
      },
      (event) => {
        const e = event as Record<string, unknown>;

        if (e.type === "status") {
          // Advance step
          if (stepIdx < 3) {
            setAnalyzeSteps(prev => prev.map((s, i) => ({
              ...s,
              done: i < stepIdx,
              active: i === stepIdx,
            })));
            stepIdx++;
          }
        }

        if (e.type === "findings") {
          setFindings((e.findings as Finding[]) ?? []);
        }

        if (e.type === "testPlan") {
          setTestPlan(((e.testPlan as TestCase[]) ?? []).map(tc => ({ ...tc, status: "queued" })));
        }

        if (e.type === "confidence") {
          setConfidence(e.confidence as number);
        }

        if (e.type === "summary") {
          setSummary(e.summary as string);
        }

        if (e.type === "done") {
          setAnalyzeSteps(prev => prev.map(s => ({ ...s, done: true, active: false })));
          setState("gate");
        }
      },
    ).catch(() => {
      setState("writing");
    });
  }

  // ── Run tests ─────────────────────────────────────────────────────────────

  async function runTests() {
    setState("running");
    setBottomTab("tests");
    setTerminalLines([]);
    setGeneratedTestCode("");
    setTestPlan(prev => prev.map(t => ({ ...t, status: "queued" })));

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    await readSSE(
      "/api/editor/run-tests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileContent, filename, language, findings, testPlan }),
        signal: abortRef.current.signal,
      },
      (event) => {
        const e = event as Record<string, unknown>;

        if (e.type === "testCode") {
          setGeneratedTestCode(e.code as string);
        }

        if (e.type === "testResult") {
          const r = e.result as { id: string; label: string; status: "pass" | "fail"; ms: number; reason?: string };
          setTestPlan(prev => {
            const existing = prev.find(t => t.id === r.id);
            if (existing) {
              return prev.map(t => t.id === r.id ? { ...t, status: r.status, ms: r.ms, reason: r.reason } : t);
            }
            // New test from LLM
            return [...prev, { id: r.id, label: r.label, generated: true, status: r.status, ms: r.ms, reason: r.reason }];
          });
        }

        if (e.type === "terminal") {
          setTerminalLines(prev => [...prev, e.line as string]);
        }

        if (e.type === "done") {
          setState("done");
        }
      },
    ).catch(() => {
      setState("gate");
    });
  }

  // ── Deploy via Terraform ───────────────────────────────────────────────────

  async function detectAndDeploy() {
    setDeploy({ phase: "detecting", lines: [] });
    setBottomTab("terminal");

    try {
      const resp = await fetch("/api/terraform/detect");
      const targets: DeployTarget[] = resp.ok ? await resp.json() : [];

      if (targets.length === 0) {
        setDeploy({ phase: "error", lines: ["No deployment targets found. Connect a cloud or Kubernetes connector first."] });
        return;
      }

      // Single meaningful target → auto-plan
      const real = targets.filter(t => t.platform !== "docker");
      if (real.length === 1) {
        await runTerraformPlan(real[0]!, targets);
        return;
      }

      // Multiple → show picker
      setDeploy({ phase: "picking", lines: [], targets });
    } catch (err) {
      setDeploy({ phase: "error", lines: [String(err)] });
    }
  }

  async function runTerraformPlan(target: DeployTarget, targets?: DeployTarget[]) {
    setDeploy({ phase: "planning", lines: [], selectedTarget: target, targets });
    setBottomTab("terminal");

    await readSSE(
      `/api/terraform/${target.tfEnv}/plan`,
      { signal: undefined },
      (event) => {
        const e = event as Record<string, unknown>;
        if (e.line) setDeploy(prev => ({ ...prev, lines: [...prev.lines, e.line as string] }));
        if (e.done) setDeploy(prev => ({ ...prev, phase: "confirming", exitCode: e.exitCode as number }));
      },
    ).catch((err) => {
      setDeploy(prev => ({ ...prev, phase: "error", lines: [...prev.lines, String(err)] }));
    });
  }

  async function runTerraformApply() {
    const target = deploy.selectedTarget;
    if (!target) return;
    setDeploy(prev => ({ ...prev, phase: "applying" }));

    await readSSE(
      `/api/terraform/${target.tfEnv}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateId }),
      },
      (event) => {
        const e = event as Record<string, unknown>;
        if (e.line) setDeploy(prev => ({ ...prev, lines: [...prev.lines, e.line as string] }));
        if (e.done) setDeploy(prev => ({ ...prev, phase: e.exitCode === 0 ? "done" : "error", exitCode: e.exitCode as number }));
      },
    ).catch((err) => {
      setDeploy(prev => ({ ...prev, phase: "error", lines: [...prev.lines, String(err)] }));
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const codeLines = fileContent.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", fontFamily: "monospace" }}>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {/* Tab bar + project picker */}
      <div style={{ height: "35px", background: "#252526", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "stretch", flexShrink: 0 }}>
        {/* File tab */}
        {filename && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 16px", background: "#1e1e1e", borderRight: "1px solid #1a1a1a", borderTop: "1px solid #0078d4", fontSize: "12px", color: "#d4d4d4" }}>
            <span style={{ color: "#3dc9b0", fontSize: "10px" }}>{extIcon(filename)}</span>
            {filename}
          </div>
        )}

        {/* Project source button */}
        <button
          onClick={() => setShowSourcePicker(v => !v)}
          style={{ marginLeft: "auto", background: "rgba(255,255,255,0.05)", border: "none", borderLeft: "1px solid #1a1a1a", color: "#888", padding: "0 12px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "5px" }}
        >
          <span>{source === "demo" ? "🔴 Demo" : source === "disk" ? "💾 Disk" : source === "service" ? `⎈ ${selectedService?.name ?? "Service"}` : "🐙 GitHub"}</span>
          <span>▾</span>
        </button>

        {/* Source picker dropdown */}
        {showSourcePicker && (
          <div style={{ position: "absolute", top: "35px", right: 0, width: "380px", background: "#252526", border: "1px solid #2a2a2a", borderRadius: "4px", zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: "12px" }}>
            <div style={{ fontSize: "11px", color: "#888", fontFamily: "sans-serif", marginBottom: "10px", fontWeight: 600 }}>Open project</div>

            {/* Source type tabs */}
            <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
              {(["demo","disk","service","github"] as ProjectSource[]).map(s => (
                <button key={s} onClick={() => setSource(s)} style={{ flex: 1, background: source === s ? "#0e639c" : "rgba(255,255,255,0.06)", border: "none", color: source === s ? "#fff" : "#888", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}>
                  {s === "demo" ? "🔴 Demo" : s === "disk" ? "💾 Disk" : s === "service" ? "⎈ Service" : "🐙 GitHub"}
                </button>
              ))}
            </div>

            {source === "demo" && (
              <div style={{ fontSize: "11px", color: "#666", fontFamily: "sans-serif", lineHeight: "1.6" }}>
                Loads the chaotic <strong style={{ color: "#d4d4d4" }}>payments-api</strong> from the demo stack — real bugs, real chaos injection, real LLM analysis.
              </div>
            )}

            {source === "disk" && (
              <div>
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "5px" }}>Absolute path to project root</div>
                <input
                  value={diskPath}
                  onChange={e => setDiskPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  style={{ width: "100%", background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "11px", padding: "6px 8px", borderRadius: "3px", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }}
                />
              </div>
            )}

            {source === "service" && (
              <div>
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "6px" }}>
                  {connectedServices.length === 0 ? "No services found — bootstrap K8s connector first" : `${connectedServices.length} service${connectedServices.length !== 1 ? "s" : ""} connected`}
                </div>
                {connectedServices.length > 0 && (
                  <div style={{ maxHeight: "160px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {connectedServices.map(svc => (
                      <button
                        key={svc.id}
                        onClick={() => setSelectedService(svc)}
                        style={{ textAlign: "left", background: selectedService?.id === svc.id ? "rgba(14,99,156,0.4)" : "rgba(255,255,255,0.04)", border: selectedService?.id === svc.id ? "1px solid #0e639c" : "1px solid transparent", borderRadius: "3px", color: "#d4d4d4", padding: "5px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "monospace" }}
                      >
                        <span style={{ color: "#10b981", marginRight: "6px" }}>⎈</span>
                        {svc.name}
                        {svc.namespace && <span style={{ color: "#555", marginLeft: "6px", fontSize: "10px" }}>{svc.namespace}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {source === "github" && (
              <div>
                <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "5px" }}>GitHub repo URL</div>
                <input
                  value={githubUrl}
                  onChange={e => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  style={{ width: "100%", background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "11px", padding: "6px 8px", borderRadius: "3px", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }}
                />
                <div style={{ fontSize: "10px", color: "#555", marginTop: "5px", fontFamily: "sans-serif" }}>Requires GitHub connector — connect via Connectors</div>
              </div>
            )}

            <button
              onClick={applySource}
              style={{ marginTop: "12px", width: "100%", background: "#0e639c", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontFamily: "sans-serif", fontWeight: 600 }}
            >
              Open project
            </button>
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div style={{ height: "22px", background: "#1e1e1e", borderBottom: "1px solid #252526", display: "flex", alignItems: "center", padding: "0 12px", gap: "4px", flexShrink: 0 }}>
        {filename.split("/").map((crumb, i, arr) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "11px", color: i === arr.length - 1 ? "#d4d4d4" : "#888" }}>{crumb}</span>
            {i < arr.length - 1 && <span style={{ fontSize: "10px", color: "#555" }}>›</span>}
          </span>
        ))}
      </div>

      {/* Main body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Activity bar */}
        <div style={{ width: "44px", background: "#333333", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "8px", gap: "4px", flexShrink: 0, borderRight: "1px solid #252526" }}>
          {ACTIVITY_ICONS.map(a => (
            <button
              key={a.id}
              title={a.title}
              onClick={() => { if (activityTab === a.id && showSidebar) setShowSidebar(false); else { setActivityTab(a.id); setShowSidebar(true); } }}
              style={{ width: "34px", height: "34px", borderRadius: "4px", background: activityTab === a.id && showSidebar ? "rgba(255,255,255,0.1)" : "transparent", border: "none", color: activityTab === a.id && showSidebar ? "#d4d4d4" : "#888", fontSize: "16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", borderLeft: activityTab === a.id && showSidebar ? "2px solid #d4d4d4" : "2px solid transparent" }}
            >
              {a.icon}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "10px", fontSize: "10px", color: "#10b981", fontWeight: 700 }} title="Anway AI">✦</div>
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div style={{ width: "220px", background: "#252526", borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>

            {activityTab === "explorer" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>
                  {source === "demo" ? "payments-api (demo)" : source === "disk" ? diskPath.split("/").pop() : "GitHub"}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                  {fileTree.length === 0 && state !== "loading" && (
                    <div style={{ padding: "12px", fontSize: "11px", color: "#555", fontFamily: "sans-serif" }}>No files loaded</div>
                  )}
                  {fileTree.map((f, i) => (
                    <div
                      key={i}
                      onClick={() => { if (!f.isDir) { setActiveFile({ ...f, active: true }); loadFile(f.path); } }}
                      style={{ display: "flex", alignItems: "center", gap: "4px", padding: `2px 0 2px ${8 + f.depth * 14}px`, fontSize: "12px", color: activeFile?.path === f.path ? "#d4d4d4" : f.isDir ? "#d4d4d4" : "#a6a6a6", background: activeFile?.path === f.path ? "#094771" : "transparent", cursor: f.isDir ? "default" : "pointer", fontFamily: "sans-serif" }}
                    >
                      {f.isDir ? (
                        <span style={{ color: "#dcb67a", fontSize: "10px" }}>▾</span>
                      ) : (
                        <span style={{ fontSize: "10px", color: "#3dc9b0", width: "14px" }}>{extIcon(f.name)}</span>
                      )}
                      <span>{f.name}</span>
                    </div>
                  ))}
                </div>

                {/* Test panel */}
                {testPlan.length > 0 && (
                  <div style={{ borderTop: "1px solid #1a1a1a" }}>
                    <div style={{ padding: "6px 12px 4px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif" }}>Testing</div>
                    {testPlan.map(tc => (
                      <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "2px 12px" }}>
                        <span style={{ fontSize: "10px", color: tc.status === "running" ? "#0078d4" : tc.status === "pass" ? "#10b981" : tc.status === "fail" ? "#f44747" : "#555", width: "10px" }}>
                          {tc.status === "running" ? "▶" : tc.status === "pass" ? "✓" : tc.status === "fail" ? "✗" : "○"}
                        </span>
                        <span style={{ fontSize: "10px", fontFamily: "monospace", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tc.id}</span>
                        {tc.generated && <span style={{ fontSize: "8px", color: "#c678dd", marginLeft: "auto", flexShrink: 0 }}>AI</span>}
                      </div>
                    ))}
                    <div style={{ height: "8px" }} />
                  </div>
                )}
              </>
            )}

            {activityTab === "search" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>Search</div>
                <div style={{ padding: "8px 10px" }}>
                  <input placeholder="Search" style={{ width: "100%", background: "#3c3c3c", border: "1px solid #555", color: "#d4d4d4", fontSize: "12px", padding: "5px 8px", borderRadius: "3px", outline: "none", boxSizing: "border-box" }} />
                </div>
              </>
            )}

            {activityTab === "git" && (
              <>
                <div style={{ padding: "8px 12px", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", borderBottom: "1px solid #1a1a1a" }}>Source Control</div>
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: "#888", fontFamily: "sans-serif", marginBottom: "8px" }}>Git Credentials</div>
                  <div style={{ fontSize: "10px", color: "#555", fontFamily: "sans-serif", marginBottom: "8px", lineHeight: "1.5" }}>
                    Store a personal access token so Anway can push code changes on your behalf.
                  </div>
                  {gitCreds.length === 0 ? (
                    <div style={{ fontSize: "10px", color: "#555", fontFamily: "sans-serif", marginBottom: "8px" }}>No credentials configured</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                      {gitCreds.map(c => (
                        <div key={c.provider} style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "3px", padding: "5px 8px", fontSize: "10px", fontFamily: "sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>
                            <span style={{ color: "#10b981", marginRight: "5px" }}>✓</span>
                            <span style={{ color: "#d4d4d4" }}>{c.provider}</span>
                            {c.username && <span style={{ color: "#555", marginLeft: "5px" }}>{c.username}</span>}
                          </span>
                          <button
                            onClick={async () => {
                              await fetch(`/api/user/git-credentials/${c.provider}`, { method: "DELETE" });
                              setGitCreds(prev => prev.filter(x => x.provider !== c.provider));
                            }}
                            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "10px" }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!showGitCredForm ? (
                    <button
                      onClick={() => setShowGitCredForm(true)}
                      style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid #2a2a2a", color: "#888", padding: "5px 8px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "sans-serif" }}
                    >+ Add credentials</button>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      <select value={gitCredProvider} onChange={e => setGitCredProvider(e.target.value)} style={{ background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "10px", padding: "5px 6px", borderRadius: "3px", outline: "none" }}>
                        <option value="github">GitHub</option>
                        <option value="gitlab">GitLab</option>
                        <option value="bitbucket">Bitbucket</option>
                      </select>
                      <input value={gitCredToken} onChange={e => setGitCredToken(e.target.value)} placeholder="Personal Access Token" type="password" style={{ background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "10px", padding: "5px 6px", borderRadius: "3px", outline: "none" }} />
                      <input value={gitCredUsername} onChange={e => setGitCredUsername(e.target.value)} placeholder="Username (optional)" style={{ background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "10px", padding: "5px 6px", borderRadius: "3px", outline: "none" }} />
                      <input value={gitCredEmail} onChange={e => setGitCredEmail(e.target.value)} placeholder="Email (optional)" style={{ background: "#1e1e1e", border: "1px solid #3a3a3a", color: "#d4d4d4", fontSize: "10px", padding: "5px 6px", borderRadius: "3px", outline: "none" }} />
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          onClick={async () => {
                            if (!gitCredToken) return;
                            const res = await fetch("/api/user/git-credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: gitCredProvider, token: gitCredToken, username: gitCredUsername || undefined, email: gitCredEmail || undefined }) });
                            if (res.ok) {
                              setGitCreds(prev => [...prev.filter(c => c.provider !== gitCredProvider), { provider: gitCredProvider, username: gitCredUsername || null, email: gitCredEmail || null, configured: true }]);
                              setGitCredToken(""); setGitCredUsername(""); setGitCredEmail(""); setShowGitCredForm(false);
                            }
                          }}
                          style={{ flex: 1, background: "#0e639c", border: "none", color: "#fff", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "sans-serif" }}
                        >Save</button>
                        <button onClick={() => setShowGitCredForm(false)} style={{ background: "rgba(255,255,255,0.06)", border: "none", color: "#888", padding: "5px 8px", borderRadius: "3px", cursor: "pointer", fontSize: "10px" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Editor + right panel */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* Code area */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", position: "relative" }}>
              {state === "loading" && (
                <div style={{ padding: "40px 20px", color: "#555", fontSize: "12px", fontFamily: "sans-serif" }}>
                  Loading…
                </div>
              )}
              {state === "idle" && (
                <div style={{ padding: "40px 20px", color: "#555", fontSize: "12px", fontFamily: "sans-serif" }}>
                  Open a project using the project picker in the top-right corner.
                </div>
              )}
              {fileContent && state !== "loading" && (
                <div style={{ padding: "8px 0", minWidth: "520px" }}>
                  {codeLines.map((lineText, idx) => {
                    const lineNum = idx + 1;
                    const finding = findings.find(f => f.line === lineNum);
                    const isActive = activeFinding === lineNum;
                    const showFinding = finding && showFindings;
                    return (
                      <div key={lineNum}>
                        <div
                          onClick={() => finding && showFindings && setActiveFinding(isActive ? null : lineNum)}
                          style={{ display: "flex", alignItems: "center", minHeight: "19px", background: isActive ? "rgba(255,255,255,0.04)" : showFinding ? (finding.severity === "error" ? "rgba(244,71,71,0.06)" : "rgba(229,192,123,0.06)") : "transparent", cursor: finding && showFindings ? "pointer" : "text" }}
                        >
                          <span style={{ width: "44px", textAlign: "right", paddingRight: "14px", fontSize: "12px", color: "#858585", flexShrink: 0, userSelect: "none", lineHeight: "19px" }}>
                            {lineNum}
                          </span>
                          <span style={{ width: "18px", flexShrink: 0, textAlign: "center" }}>
                            {showFinding && (
                              <span style={{ fontSize: "11px", color: finding.severity === "error" ? "#f44747" : "#cca700" }}>●</span>
                            )}
                          </span>
                          <span style={{ fontSize: "13px", lineHeight: "19px", color: "#d4d4d4", whiteSpace: "pre" }}>
                            {lineText}
                          </span>
                          {showFinding && (
                            <span style={{ marginLeft: "20px", fontSize: "11px", fontFamily: "sans-serif", color: finding.severity === "error" ? "#f44747" : "#cca700", opacity: 0.9, flexShrink: 0 }}>
                              {finding.title}
                            </span>
                          )}
                        </div>
                        {isActive && finding && (
                          <div style={{ margin: "2px 62px 6px", background: "#252526", border: `1px solid ${finding.severity === "error" ? "#f4474766" : "#cca70066"}`, borderRadius: "4px", padding: "10px 12px", fontSize: "11px", fontFamily: "sans-serif" }}>
                            <div style={{ color: finding.severity === "error" ? "#f44747" : "#cca700", fontWeight: 600, marginBottom: "5px" }}>{finding.title}</div>
                            <div style={{ color: "#9d9d9d", lineHeight: "1.5", marginBottom: "8px" }}>{finding.body}</div>
                            {finding.test && (
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.2)", borderRadius: "3px", padding: "5px 8px" }}>
                                <span style={{ color: "#c586c0", fontSize: "10px" }}>✦ Test generated:</span>
                                <code style={{ fontSize: "11px", color: "#ce9178" }}>{finding.test}</code>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {state === "writing" && (
                    <div style={{ display: "flex", alignItems: "center", minHeight: "19px", paddingLeft: "62px" }}>
                      <span style={{ display: "inline-block", width: "1px", height: "14px", background: "#d4d4d4", animation: "blink 1.2s step-end infinite" }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right review panel */}
            <div style={{ width: "260px", background: "#252526", borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", fontSize: "10px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#10b981" }}>✦</span> Anway
                {state === "analyzing" && <span style={{ marginLeft: "auto", color: "#0078d4", animation: "pulse-dot 1s infinite" }}>●</span>}
              </div>

              {/* Idle/writing */}
              {(state === "idle" || state === "loading") && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.2 }}>✦</div>
                  <div style={{ fontSize: "12px", color: "#444", fontFamily: "sans-serif" }}>Open a project to get started</div>
                </div>
              )}

              {state === "writing" && fileContent && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.3 }}>✦</div>
                  <div style={{ fontSize: "12px", color: "#666", fontFamily: "sans-serif", lineHeight: "1.6" }}>AI review finds bugs and generates tests</div>
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "8px", fontFamily: "sans-serif" }}>Analysis · Tests · Terraform deploy</div>
                  <button
                    onClick={runAnalysis}
                    style={{ marginTop: "16px", background: "rgba(0,120,212,0.15)", border: "1px solid rgba(0,120,212,0.4)", color: "#0078d4", padding: "6px 14px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}
                  >
                    Analyze now ✦
                  </button>
                </div>
              )}

              {/* Analyzing */}
              {state === "analyzing" && (
                <div style={{ padding: "14px", flex: 1 }}>
                  <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "12px" }}>Analyzing {filename}…</div>
                  {analyzeSteps.map((step, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", opacity: step.done || step.active ? 1 : 0.25, transition: "opacity 0.3s" }}>
                      <span style={{ fontSize: "11px", color: step.done ? "#10b981" : step.active ? "#0078d4" : "#555", width: "12px", flexShrink: 0 }}>
                        {step.done ? "✓" : step.active ? "▶" : "○"}
                      </span>
                      <span style={{ fontSize: "11px", color: step.done ? "#888" : step.active ? "#d4d4d4" : "#666", fontFamily: "sans-serif" }}>{step.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Gate / Running / Done */}
              {showFindings && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* Summary */}
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                    <div style={{ fontSize: "11px", color: "#d4d4d4", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "3px" }}>{filename}</div>
                    {analysisSummary && <div style={{ fontSize: "10px", color: "#888", fontFamily: "sans-serif", lineHeight: "1.4", marginBottom: "5px" }}>{analysisSummary}</div>}
                    <div style={{ display: "flex", gap: "8px", marginTop: "5px" }}>
                      <span style={{ fontSize: "10px", color: "#f44747" }}>● {errorCount}</span>
                      <span style={{ fontSize: "10px", color: "#cca700" }}>▲ {warnCount}</span>
                      <span style={{ fontSize: "10px", color: "#c586c0" }}>✦ {testPlan.filter(t => t.generated).length} AI tests</span>
                    </div>
                  </div>

                  {/* Findings */}
                  {findings.length > 0 && (
                    <div style={{ padding: "8px 10px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                      <div style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif", marginBottom: "5px" }}>Review</div>
                      {findings.map(f => (
                        <div
                          key={f.line}
                          onClick={() => setActiveFinding(activeFinding === f.line ? null : f.line)}
                          style={{ padding: "5px 7px", borderRadius: "3px", marginBottom: "3px", cursor: "pointer", background: activeFinding === f.line ? "#3c3c3c" : "transparent", display: "flex", gap: "6px", alignItems: "flex-start" }}
                        >
                          <span style={{ fontSize: "10px", color: f.severity === "error" ? "#f44747" : "#cca700", flexShrink: 0, marginTop: "1px" }}>●</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "11px", color: "#d4d4d4", fontFamily: "sans-serif" }}>{f.title}</div>
                            <div style={{ fontSize: "10px", color: "#555", fontFamily: "sans-serif" }}>{filename}:{f.line}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Test plan */}
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid #1a1a1a", flex: 1, overflowY: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "sans-serif" }}>Test Plan</span>
                      <span style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif" }}>
                        {state === "done" ? `${passCount}✓ ${failCount > 0 ? failCount + "✗" : ""}` : `${testPlan.length} cases`}
                      </span>
                    </div>
                    {testPlan.map(tc => (
                      <div key={tc.id} style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "6px", padding: "4px 6px", borderRadius: "3px", background: tc.status === "running" ? "rgba(0,120,212,0.1)" : tc.status === "fail" ? "rgba(244,71,71,0.06)" : "transparent" }}>
                        <span style={{ fontSize: "11px", color: tc.status === "running" ? "#0078d4" : tc.status === "pass" ? "#10b981" : tc.status === "fail" ? "#f44747" : "#555", flexShrink: 0, marginTop: "1px", width: "12px" }}>
                          {tc.status === "running" ? "▶" : tc.status === "pass" ? "✓" : tc.status === "fail" ? "✗" : "○"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "10px", color: "#888", fontFamily: "monospace" }}>{tc.id}</div>
                          <div style={{ fontSize: "11px", color: tc.status === "fail" ? "#f44747" : tc.status === "pass" ? "#888" : "#666", fontFamily: "sans-serif", lineHeight: "1.3", marginTop: "1px" }}>{tc.label}</div>
                          {tc.ms !== undefined && <div style={{ fontSize: "9px", color: "#555", marginTop: "1px" }}>{tc.ms}ms</div>}
                        </div>
                        {tc.generated && (
                          <span style={{ fontSize: "9px", color: "#c586c0", flexShrink: 0, marginTop: "2px", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.2)", borderRadius: "2px", padding: "0 3px" }}>AI</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Confidence */}
                  {confidence !== null && (
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif" }}>Confidence</span>
                        <span style={{ fontSize: "11px", color: confidence >= 0.9 ? "#10b981" : confidence >= 0.7 ? "#cca700" : "#f44747", fontFamily: "monospace", fontWeight: 700 }}>{confidence.toFixed(2)}</span>
                      </div>
                      <div style={{ height: "3px", background: "#3c3c3c", borderRadius: "2px" }}>
                        <div style={{ width: `${confidence * 100}%`, height: "100%", background: confidence >= 0.9 ? "#10b981" : confidence >= 0.7 ? "#cca700" : "#f44747", borderRadius: "2px" }} />
                      </div>
                      {confidence < 0.9 && <div style={{ fontSize: "10px", color: "#555", marginTop: "4px", fontFamily: "sans-serif" }}>Below 0.90 — human gate required</div>}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ padding: "10px 12px", flexShrink: 0 }}>
                    {state === "gate" && (
                      <>
                        <button
                          onClick={runTests}
                          style={{ width: "100%", background: "#0e639c", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "5px" }}
                        >
                          Approve &amp; Run Tests
                        </button>
                        <button onClick={runAnalysis} style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}>
                          Re-analyze
                        </button>
                      </>
                    )}
                    {state === "running" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#0078d4", fontFamily: "sans-serif" }}>
                        <span style={{ animation: "pulse-dot 0.8s infinite" }}>●</span>
                        Running tests…
                      </div>
                    )}
                    {state === "done" && (
                      <>
                        {failCount === 0 ? (
                          <>
                            {deploy.phase === "idle" && (
                              <button onClick={detectAndDeploy} style={{ width: "100%", background: "#16825d", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "5px" }}>
                                Deploy ✦
                              </button>
                            )}
                            {deploy.phase === "detecting" && (
                              <div style={{ fontSize: "11px", color: "#0078d4", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ animation: "pulse-dot 0.8s infinite" }}>●</span> Detecting targets…
                              </div>
                            )}
                            {deploy.phase === "picking" && deploy.targets && (
                              <div>
                                <div style={{ fontSize: "10px", color: "#cca700", fontFamily: "sans-serif", marginBottom: "6px" }}>Multiple deployment targets found — pick one:</div>
                                {deploy.targets.map(t => (
                                  <button
                                    key={t.id}
                                    onClick={() => runTerraformPlan(t, deploy.targets)}
                                    style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#d4d4d4", padding: "7px 10px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", marginBottom: "4px", textAlign: "left", display: "flex", alignItems: "center", gap: "6px" }}
                                  >
                                    <span style={{ fontSize: "10px", color: t.platform === "docker" ? "#888" : "#10b981" }}>
                                      {t.platform === "k8s" ? "⎈" : t.platform === "ecs" ? "▣" : t.platform === "gitops" ? "⬡" : "◻"}
                                    </span>
                                    <span>{t.label}</span>
                                  </button>
                                ))}
                                <button onClick={() => setDeploy({ phase: "idle", lines: [] })} style={{ width: "100%", background: "transparent", border: "1px solid #333", color: "#666", padding: "4px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "sans-serif" }}>Cancel</button>
                              </div>
                            )}
                            {deploy.phase === "planning" && (
                              <div>
                                <div style={{ fontSize: "10px", color: "#666", fontFamily: "sans-serif", marginBottom: "4px" }}>
                                  → {deploy.selectedTarget?.label}
                                </div>
                                <div style={{ fontSize: "11px", color: "#0078d4", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ animation: "pulse-dot 0.8s infinite" }}>●</span> Planning…
                                </div>
                              </div>
                            )}
                            {deploy.phase === "confirming" && (
                              <div>
                                <div style={{ fontSize: "10px", color: "#cca700", fontFamily: "sans-serif", marginBottom: "6px" }}>
                                  Plan ready for <strong>{deploy.selectedTarget?.label}</strong> — review in terminal, then apply:
                                </div>
                                <button onClick={runTerraformApply} style={{ width: "100%", background: "#16825d", border: "none", color: "#fff", padding: "7px", borderRadius: "3px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "sans-serif", marginBottom: "5px" }}>
                                  terraform apply ✓
                                </button>
                                <button onClick={() => setDeploy({ phase: "idle", lines: [] })} style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif" }}>
                                  Cancel
                                </button>
                              </div>
                            )}
                            {deploy.phase === "applying" && (
                              <div style={{ fontSize: "11px", color: "#0078d4", fontFamily: "sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ animation: "pulse-dot 0.8s infinite" }}>●</span> Applying to {deploy.selectedTarget?.label}…
                              </div>
                            )}
                            {deploy.phase === "done" && (
                              <div style={{ fontSize: "11px", color: "#10b981", fontFamily: "sans-serif" }}>✓ Deployed to {deploy.selectedTarget?.label}</div>
                            )}
                            {deploy.phase === "error" && (
                              <div>
                                <div style={{ fontSize: "11px", color: "#f44747", fontFamily: "sans-serif", marginBottom: "5px" }}>✗ Failed — see terminal</div>
                                <button onClick={detectAndDeploy} style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "4px", borderRadius: "3px", cursor: "pointer", fontSize: "10px", fontFamily: "sans-serif" }}>Retry</button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: "11px", color: "#f44747", fontFamily: "sans-serif", background: "rgba(244,71,71,0.08)", border: "1px solid rgba(244,71,71,0.2)", borderRadius: "3px", padding: "7px 10px", marginBottom: "6px" }}>
                              ✗ Blocked — {failCount} test{failCount > 1 ? "s" : ""} failing
                            </div>
                            <button onClick={runAnalysis} style={{ width: "100%", background: "rgba(197,134,192,0.1)", border: "1px solid rgba(197,134,192,0.3)", color: "#c586c0", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", marginBottom: "5px" }}>
                              ✦ Re-analyze
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setState("writing"); setFindings([]); setTestPlan([]); setConfidence(null); setSummary(""); setActiveFinding(null); setDeploy({ phase: "idle", lines: [] }); }}
                          style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#a6a6a6", padding: "5px", borderRadius: "3px", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", marginTop: "4px" }}
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

          {/* Bottom panel */}
          <div style={{ height: bottomHeight + "px", background: "#1e1e1e", borderTop: "1px solid #252526", flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ height: "28px", background: "#252526", display: "flex", alignItems: "stretch", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
              {(["problems","tests","terminal"] as BottomTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  style={{ padding: "0 14px", background: bottomTab === tab ? "#1e1e1e" : "transparent", border: "none", borderTop: bottomTab === tab ? "1px solid #0078d4" : "1px solid transparent", color: bottomTab === tab ? "#d4d4d4" : "#888", fontSize: "11px", cursor: "pointer", fontFamily: "sans-serif", textTransform: "capitalize", display: "flex", alignItems: "center", gap: "5px" }}
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
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", paddingRight: "10px" }}>
                <button onClick={() => setBottomHeight(h => h === 180 ? 300 : 180)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "12px" }}>
                  {bottomHeight > 180 ? "▾" : "▴"}
                </button>
                <button onClick={() => setBottomHeight(0)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "14px" }}>×</button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "6px 14px" }}>
              {bottomTab === "problems" && (
                <>
                  {!showFindings && <div style={{ fontSize: "11px", color: "#666", fontFamily: "sans-serif", padding: "8px 0" }}>No problems detected. Click &quot;Analyze now&quot; to run AI review.</div>}
                  {showFindings && findings.length === 0 && <div style={{ fontSize: "11px", color: "#10b981", fontFamily: "sans-serif", padding: "8px 0" }}>✓ No issues found</div>}
                  {showFindings && findings.map(f => (
                    <div key={f.line} onClick={() => setActiveFinding(activeFinding === f.line ? null : f.line)} style={{ display: "flex", gap: "8px", padding: "4px 0", cursor: "pointer", fontSize: "11px", fontFamily: "sans-serif", alignItems: "flex-start" }}>
                      <span style={{ color: f.severity === "error" ? "#f44747" : "#cca700", flexShrink: 0 }}>●</span>
                      <span style={{ color: "#d4d4d4" }}>{f.title}</span>
                      <span style={{ color: "#666" }}>{filename}:{f.line}</span>
                      <span style={{ color: "#555", marginLeft: "auto" }}>Anway</span>
                    </div>
                  ))}
                </>
              )}

              {bottomTab === "tests" && (
                <div>
                  {testPlan.length === 0 && <div style={{ fontSize: "11px", color: "#666", fontFamily: "sans-serif", padding: "8px 0" }}>No tests yet. Run analysis first.</div>}
                  {testPlan.map(tc => (
                    <div key={tc.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", fontSize: "11px", fontFamily: "sans-serif" }}>
                      <span style={{ color: tc.status === "running" ? "#0078d4" : tc.status === "pass" ? "#10b981" : tc.status === "fail" ? "#f44747" : "#555", width: "12px" }}>
                        {tc.status === "running" ? "▶" : tc.status === "pass" ? "✓" : tc.status === "fail" ? "✗" : "○"}
                      </span>
                      <span style={{ color: tc.status === "fail" ? "#f44747" : "#888" }}>{tc.id}</span>
                      <span style={{ color: "#666" }}>—</span>
                      <span style={{ color: tc.status === "fail" ? "#f44747" : tc.status === "pass" ? "#888" : "#555", flex: 1 }}>{tc.label}</span>
                      {tc.ms !== undefined && <span style={{ color: "#555", fontSize: "10px" }}>{tc.ms}ms</span>}
                      {tc.generated && <span style={{ fontSize: "9px", color: "#c586c0" }}>AI</span>}
                    </div>
                  ))}
                </div>
              )}

              {bottomTab === "terminal" && (
                <div>
                  {/* Deploy output */}
                  {deploy.lines.map((line, i) => (
                    <div key={i} style={{ fontSize: "12px", color: line.includes("Error") || line.includes("error") ? "#f44747" : line.includes("Apply complete") || line.includes("Apply") ? "#10b981" : "#d4d4d4", lineHeight: "1.5", minHeight: "18px", whiteSpace: "pre-wrap" }}>
                      {line || " "}
                    </div>
                  ))}
                  {/* Test terminal output */}
                  {terminalLines.map((line, i) => (
                    <div key={`t${i}`} style={{ fontSize: "12px", color: "#888", lineHeight: "1.5" }}>{line}</div>
                  ))}
                  {/* Generated test code */}
                  {generatedTestCode && deploy.lines.length === 0 && (
                    <>
                      <div style={{ fontSize: "10px", color: "#555", fontFamily: "sans-serif", marginBottom: "4px", marginTop: "8px" }}>Generated test code:</div>
                      <pre style={{ fontSize: "11px", color: "#d4d4d4", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {generatedTestCode.slice(0, 800)}
                        {generatedTestCode.length > 800 && "\n… (truncated)"}
                      </pre>
                    </>
                  )}
                  {(state === "writing" || state === "idle") && deploy.lines.length === 0 && terminalLines.length === 0 && (
                    <span style={{ display: "inline-block", width: "6px", height: "13px", background: "#d4d4d4", animation: "blink 1.2s step-end infinite" }} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ height: "22px", background: "#007acc", display: "flex", alignItems: "center", padding: "0 10px", gap: "14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#fff" }}>
          <span>⬡</span>
          <span>{source === "demo" ? "demo/payments-api" : source === "disk" ? diskPath.split("/").pop() ?? "project" : "GitHub"}</span>
        </div>
        {showFindings && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#fff" }}>
            <span>● {errorCount}</span>
            <span>▲ {warnCount}</span>
          </div>
        )}
        {(state === "running" || state === "done") && (
          <div style={{ fontSize: "11px", color: "#fff" }}>
            Tests: {passCount} passed{failCount > 0 ? `, ${failCount} failed` : ""}
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", fontSize: "11px", color: "#ffffffb0" }}>
          <span>{language}</span>
          <span>UTF-8</span>
          {filename && <span>{codeLines.length} lines</span>}
          <span style={{ color: "#fff", background: "rgba(255,255,255,0.15)", padding: "0 6px", borderRadius: "2px" }}>✦ Anway</span>
        </div>
        {state === "writing" && fileContent && (
          <button
            onClick={runAnalysis}
            style={{ marginLeft: "8px", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", padding: "1px 8px", borderRadius: "2px", cursor: "pointer", fontSize: "11px" }}
          >
            Analyze ✦
          </button>
        )}
      </div>
    </div>
  );
}

// ── Demo fallback — shown when gateway is unreachable ──────────────────────────

const DEMO_FALLBACK_CODE = `const express = require('express');
const app = express();
app.use(express.json());

const PORT = 3010;
const SERVICE = 'payments-api';
let errorRate = 0.15;  // BUG: intentional chaos injection
let inSpike = false;
let reqSuccess = 0, reqError = 0;

// Spike error rate every ~90s for 20s
setInterval(() => {
  if (!inSpike) {
    inSpike = true;
    errorRate = 0.6;  // BUG: 60% error rate during spike
    setTimeout(() => { errorRate = 0.15; inSpike = false; }, 20000);
  }
}, 90000 + Math.random() * 30000);

app.get('/health', (_req, res) => { reqSuccess++; res.json({ status: 'ok', service: SERVICE }); });

app.post('/pay', (req, res) => {
  if (Math.random() < errorRate) {  // BUG: random failures
    reqError++;
    return res.status(500).json({ error: 'payment_failed' });
  }
  reqSuccess++;
  res.json({ status: 'ok', transactionId: Math.random().toString(36).slice(2) });  // BUG: weak ID
});

app.listen(PORT, () => console.log(JSON.stringify({ level: 'info', service: SERVICE, msg: 'started', port: PORT })));
`.trim();
