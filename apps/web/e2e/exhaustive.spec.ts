import { test } from '@playwright/test'
import { sweepView } from './exhaustive-sweep'

// EXHAUSTIVE per-view interaction sweep. One test per nav view — each drives
// EVERY interactive control on that screen (every button, input, select,
// textarea, and any modal/panel they reveal), failing on any JS error.
// Non-negotiable coverage: every fragment a user can touch.

const VIEWS = [
  'Anway', 'Signals', 'War Room', 'Services', 'Projects', 'Pipeline',
  'Environments', 'Routing', 'Lifecycle', 'Editor', 'Knowledge', 'Workflows',
  'Approvals', 'Automations', 'API Client', 'Connectors', 'Audit', 'Access',
  'Settings', 'Cloud', 'K8s',
]

for (const view of VIEWS) {
  test(`exhaustive sweep — ${view} (every control)`, async ({ page }) => {
    test.setTimeout(180000) // exhaustive sweep clicks dozens of controls
    await sweepView(page, view)
  })
}
