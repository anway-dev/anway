import { providerRegistry } from './registry.js'
import type { ProviderConfig, IModelProvider, IEmbeddingProvider } from '../interfaces/provider.js'
import { OpenAIEmbeddingProvider, OllamaEmbeddingProvider } from './embeddings.js'

// ProviderFactory delegates to registry — providers register via ProviderManifest, no code change needed.
export class ProviderFactory {
  static create(config: ProviderConfig): IModelProvider {
    return providerRegistry.createProvider(config)
  }

  /** Resolves an embedding provider from the same credentials used for LLM inference. */
  static createEmbedder(config: ProviderConfig): IEmbeddingProvider | null {
    switch (config.type) {
      case 'openai':
        if (config.apiKey) {
          return new OpenAIEmbeddingProvider(config.apiKey, config.baseURL ?? 'https://api.openai.com/v1')
        }
        return null
      case 'ollama':
        return new OllamaEmbeddingProvider(config.baseURL ?? 'http://localhost:11434')
      default:
        // Other providers don't have embedding endpoints — embeddings are optional
        return null
    }
  }
}
