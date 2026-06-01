import { AppError } from '@anvay/types'
import type { IModelProvider, ProviderConfig } from '../interfaces/provider.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import { OllamaProvider } from './ollama.js'

// ProviderFactory is the ONLY place provider SDKs are imported.
// Agent and orchestrator code must call ProviderFactory.create(), never instantiate providers directly.
export class ProviderFactory {
  static create(config: ProviderConfig): IModelProvider {
    switch (config.type) {
      case 'anthropic':
        return new AnthropicProvider(config)

      case 'openai':
        return new OpenAIProvider(config)

      case 'ollama':
        return new OllamaProvider(config)

      // Groq is OpenAI-compatible — reuse OpenAIProvider with Groq base URL
      case 'groq':
        return new OpenAIProvider({
          ...config,
          baseURL: config.baseURL ?? 'https://api.groq.com/openai/v1',
        })

      // Mistral is OpenAI-compatible
      case 'mistral':
        return new OpenAIProvider({
          ...config,
          baseURL: config.baseURL ?? 'https://api.mistral.ai/v1',
        })

      // LM Studio uses Ollama-style fetch against a local OpenAI-compatible endpoint
      case 'lmstudio':
        return new OllamaProvider({
          ...config,
          baseURL: config.baseURL ?? 'http://localhost:1234/v1',
        })

      default: {
        const _exhaustive: never = config.type
        throw new AppError('VALIDATION_ERROR', `Unknown provider type: ${String(_exhaustive)}`)
      }
    }
  }
}
