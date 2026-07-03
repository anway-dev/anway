import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

describe("GET /api/providers", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.OLLAMA_ENDPOINT;
    delete process.env.LMSTUDIO_ENDPOINT;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns all seven providers", async () => {
    const res = await GET();
    const data = await res.json() as { providers: { id: string; configured: boolean }[] };
    expect(data.providers).toHaveLength(7);
    const ids = data.providers.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("groq");
    expect(ids).toContain("mistral");
    expect(ids).toContain("ollama");
    expect(ids).toContain("lmstudio");
  });

  it("shows configured:false when env vars are unset", async () => {
    const res = await GET();
    const data = await res.json() as { providers: { id: string; configured: boolean }[] };
    for (const p of data.providers) {
      expect(p.configured).toBe(false);
    }
  });

  it("shows configured:true when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const res = await GET();
    const data = await res.json() as { providers: { id: string; configured: boolean }[] };
    const anthropic = data.providers.find((p) => p.id === "anthropic");
    expect(anthropic?.configured).toBe(true);
  });

  it("never returns key values — only boolean status", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-super-secret";
    const res = await GET();
    const body = await res.text();
    expect(body).not.toContain("sk-ant-super-secret");
    expect(body).not.toContain("API_KEY");
  });

  it("configured:true only when env var is a non-empty string", async () => {
    process.env.OPENAI_API_KEY = "";
    const res = await GET();
    const data = await res.json() as { providers: { id: string; configured: boolean }[] };
    const openai = data.providers.find((p) => p.id === "openai");
    expect(openai?.configured).toBe(false);
  });
});
