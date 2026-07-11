import type { ProviderManifest, ProviderConfig, IModelProvider } from '../interfaces/provider.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'
import { OllamaProvider } from './ollama.js'
import { AppError } from '@anway/types'

class ProviderManifestRegistry {
  private manifests = new Map<string, ProviderManifest>()

  register(manifest: ProviderManifest): void {
    this.manifests.set(manifest.id, manifest)
  }

  list(): ProviderManifest[] {
    return [...this.manifests.values()]
  }

  get(id: string): ProviderManifest | undefined {
    return this.manifests.get(id)
  }

  createProvider(config: ProviderConfig): IModelProvider {
    const manifest = this.manifests.get(config.type)
    if (!manifest) throw new AppError('VALIDATION_ERROR', `Unknown provider: ${config.type}`)
    if (manifest.factory) return manifest.factory(config)
    if (manifest.openAICompatible) {
      // Spread entire config — preserves cheapModel + any future fields.
      // The explicit pick-and-cast previously dropped cheapModel for all
      // OpenAI-compatible providers (groq/mistral/deepseek/lmstudio).
      const resolvedBaseURL = config.baseURL ?? manifest.defaultBaseUrl
      return new OpenAIProvider({
        ...config,
        ...(resolvedBaseURL ? { baseURL: resolvedBaseURL } : {}),
      })
    }
    throw new AppError('VALIDATION_ERROR', `Provider ${config.type} has no factory and is not OpenAI-compatible`)
  }
}

export const providerRegistry = new ProviderManifestRegistry()

// Register all built-in providers at module load
providerRegistry.register({
  id: 'anthropic',
  displayName: 'Anthropic',
  website: 'https://anthropic.com',
  fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-ant-...' }],
  models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001'],
  openAICompatible: false,
  factory: (c) => new AnthropicProvider(c),
})

providerRegistry.register({
  id: 'openai',
  displayName: 'OpenAI',
  website: 'https://openai.com',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
    { key: 'baseURL', label: 'Base URL (optional)', type: 'url', required: false, defaultValue: 'https://api.openai.com/v1' },
  ],
  models: 'dynamic',
  modelsEndpoint: '/v1/models',
  defaultBaseUrl: 'https://api.openai.com/v1',
  openAICompatible: true,
})

providerRegistry.register({
  id: 'deepseek',
  displayName: 'DeepSeek',
  website: 'https://deepseek.com',
  fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' }],
  models: 'dynamic',
  modelsEndpoint: '/v1/models',
  // Shown when the live /v1/models call can't run (e.g. no key yet) so the
  // Model / Cheap-model pickers always have options — DeepSeek's real model
  // set is exactly these two.
  staticFallback: ['deepseek-chat', 'deepseek-reasoner'],
  defaultBaseUrl: 'https://api.deepseek.com',
  openAICompatible: true,
})

providerRegistry.register({
  id: 'groq',
  displayName: 'Groq',
  website: 'https://groq.com',
  fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'gsk_...' }],
  models: 'dynamic',
  modelsEndpoint: '/v1/models',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  openAICompatible: true,
})

providerRegistry.register({
  id: 'mistral',
  displayName: 'Mistral',
  website: 'https://mistral.ai',
  fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'ey...' }],
  models: 'dynamic',
  modelsEndpoint: '/v1/models',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  openAICompatible: true,
})

providerRegistry.register({
  id: 'ollama',
  displayName: 'Ollama (local)',
  website: 'https://ollama.ai',
  fields: [{ key: 'baseURL', label: 'Ollama endpoint', type: 'url', required: true, defaultValue: 'http://localhost:11434' }],
  models: 'dynamic',
  modelsEndpoint: '/api/tags',
  openAICompatible: false,
  factory: (c) => new OllamaProvider(c),
})

providerRegistry.register({
  id: 'lmstudio',
  displayName: 'LM Studio',
  website: 'https://lmstudio.ai',
  fields: [{ key: 'baseURL', label: 'LM Studio endpoint', type: 'url', required: true, defaultValue: 'http://localhost:1234/v1' }],
  models: 'dynamic',
  modelsEndpoint: '/v1/models',
  defaultBaseUrl: 'http://localhost:1234/v1',
  openAICompatible: true,
})
