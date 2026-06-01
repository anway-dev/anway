import { describe, it, expect } from "vitest";
import { POST } from "./route";

describe("POST /api/chat", () => {
  it("returns text/event-stream content type", async () => {
    const res = await POST();
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("streams stub SSE payload with text_delta and DONE", async () => {
    const res = await POST();
    const body = await res.text();
    expect(body).toContain('"type":"text_delta"');
    expect(body).toContain("[DONE]");
  });

  it("never includes API key values in response", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-secret";
    const res = await POST();
    const body = await res.text();
    expect(body).not.toContain("sk-ant-test-secret");
    delete process.env.ANTHROPIC_API_KEY;
  });
});
