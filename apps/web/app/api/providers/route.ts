export async function GET() {
  try {
    const providers = [
      { id: "anthropic", configured: Boolean(process.env.ANTHROPIC_API_KEY) },
      { id: "openai", configured: Boolean(process.env.OPENAI_API_KEY) },
      { id: "groq", configured: Boolean(process.env.GROQ_API_KEY) },
      { id: "mistral", configured: Boolean(process.env.MISTRAL_API_KEY) },
      { id: "ollama", configured: Boolean(process.env.OLLAMA_ENDPOINT) },
      { id: "lmstudio", configured: Boolean(process.env.LMSTUDIO_ENDPOINT) },
    ];
    return Response.json({ providers });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'proxy error' }, { status: 502 })
  }
}
