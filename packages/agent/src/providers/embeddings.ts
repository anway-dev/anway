import type { IEmbeddingProvider } from '../interfaces/provider.js'

// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider — calls /v1/embeddings with a real API key
// ---------------------------------------------------------------------------
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.openai.com/v1',
    private readonly model = 'text-embedding-3-small',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseURL}/embeddings`
    const results: number[][] = []

    // OpenAI supports batch embedding up to 2048 inputs per call.
    // Process in batches of 100 for safety.
    const BATCH_SIZE = 100
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown error')
        throw new Error(`OpenAI embeddings failed: HTTP ${res.status} — ${err}`)
      }
      const json = await res.json() as { data: Array<{ embedding: number[] }> }
      for (const item of json.data) {
        results.push(item.embedding)
      }
    }
    return results
  }
}

// ---------------------------------------------------------------------------
// OllamaEmbeddingProvider — calls /api/embeddings on local Ollama
// ---------------------------------------------------------------------------
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  constructor(
    private readonly baseURL = 'http://localhost:11434',
    private readonly model = 'nomic-embed-text',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseURL}/api/embeddings`
    const results: number[][] = []

    for (const text of texts) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown error')
        throw new Error(`Ollama embeddings failed: HTTP ${res.status} — ${err}`)
      }
      const json = await res.json() as { embedding: number[] }
      results.push(json.embedding)
    }
    return results
  }
}
