import { providerRegistry } from './registry.js'
import type { ProviderConfig, IModelProvider } from '../interfaces/provider.js'

// ProviderFactory delegates to registry — providers register via ProviderManifest, no code change needed.
export class ProviderFactory {
  static create(config: ProviderConfig): IModelProvider {
    return providerRegistry.createProvider(config)
  }
}
