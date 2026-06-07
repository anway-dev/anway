import { describe, it, expect } from 'vitest'
import {
  TenantId,
  UserId,
  SessionId,
  ConnectorId,
  ok,
  err,
  AppError,
  ErrorCode,
  AgentRole,
  ConnectorMode,
} from './index.js'
import type { Result, StreamEvent } from './index.js'

describe('branded ID constructors', () => {
  it('TenantId constructor produces typed value', () => {
    const id = TenantId('tenant-123')
    expect(id).toBe('tenant-123')
  })

  it('UserId constructor produces typed value', () => {
    const id = UserId('user-456')
    expect(id).toBe('user-456')
  })

  it('SessionId constructor produces typed value', () => {
    const id = SessionId('session-789')
    expect(id).toBe('session-789')
  })

  it('ConnectorId constructor produces typed value', () => {
    const id = ConnectorId('connector-abc')
    expect(id).toBe('connector-abc')
  })
})

describe('Result<T, E>', () => {
  it('ok() returns Ok with value', () => {
    const result = ok(42)
    expect(result.ok).toBe(true)
    expect(result.value).toBe(42)
  })

  it('err() returns Err with error', () => {
    const error = new AppError('NOT_FOUND', 'not found')
    const result = err(error)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(error)
  })

  it('exhaustive check compiles — switch on ok handles both branches', () => {
    // Route through a function so TypeScript sees the union type, not the concrete value
    const makeOk = (): Result<string> => ok('hello')
    const result = makeOk()

    let output: string
    if (result.ok) {
      output = result.value
    } else {
      output = result.error.message
    }
    expect(output).toBe('hello')
  })

  it('err branch returns error message', () => {
    const makeErr = (): Result<string> => err(new AppError('UNAUTHORIZED', 'not allowed'))
    const result = makeErr()
    let output: string
    if (result.ok) {
      output = result.value
    } else {
      output = result.error.message
    }
    expect(output).toBe('not allowed')
  })
})

describe('AppError', () => {
  it('has correct name, code, and message', () => {
    const e = new AppError('FORBIDDEN', 'access denied')
    expect(e.name).toBe('AppError')
    expect(e.code).toBe('FORBIDDEN')
    expect(e.message).toBe('access denied')
  })

  it('chains cause stack when provided', () => {
    const cause = new Error('root cause')
    const e = new AppError('UPSTREAM_ERROR', 'upstream failed', cause)
    expect(e.stack).toContain('Caused by:')
    expect(e.cause).toBe(cause)
  })
})

describe('ErrorCode', () => {
  it('contains all 8 required codes', () => {
    const codes = Object.values(ErrorCode)
    expect(codes).toContain('UNAUTHORIZED')
    expect(codes).toContain('FORBIDDEN')
    expect(codes).toContain('NOT_FOUND')
    expect(codes).toContain('VALIDATION_ERROR')
    expect(codes).toContain('UPSTREAM_ERROR')
    expect(codes).toContain('RATE_LIMITED')
    expect(codes).toContain('TOKEN_LIMIT_EXCEEDED')
    expect(codes).toContain('INTENT_CLASSIFICATION_FAILED')
    expect(codes).toHaveLength(8)
  })
})

describe('AgentRole', () => {
  it('contains all 5 roles', () => {
    const roles = Object.values(AgentRole)
    expect(roles).toContain('sre')
    expect(roles).toContain('dev')
    expect(roles).toContain('pm')
    expect(roles).toContain('ba')
    expect(roles).toContain('admin')
    expect(roles).toHaveLength(5)
  })
})

describe('ConnectorMode', () => {
  it('contains all 3 modes', () => {
    const modes = Object.values(ConnectorMode)
    expect(modes).toContain('read')
    expect(modes).toContain('write')
    expect(modes).toContain('read-write')
    expect(modes).toHaveLength(3)
  })
})

describe('StreamEvent discriminated union', () => {
  it('text_delta event has type and content', () => {
    const event: StreamEvent = { type: 'text_delta', content: 'hello' }
    expect(event.type).toBe('text_delta')
    if (event.type === 'text_delta') {
      expect(event.content).toBe('hello')
    }
  })

  it('tool_call event has toolName, toolCallId, args', () => {
    const event: StreamEvent = {
      type: 'tool_call',
      toolName: 'github.list_prs',
      toolCallId: 'tc-1',
      args: { repo: 'org/repo' },
    }
    expect(event.type).toBe('tool_call')
  })

  it('gate_required event has gateId, action, target, confidence', () => {
    const event: StreamEvent = {
      type: 'gate_required',
      gateId: 'gate-1',
      action: 'deploy',
      target: 'payments-api',
      confidence: 0.92,
    }
    expect(event.type).toBe('gate_required')
    if (event.type === 'gate_required') {
      expect(event.confidence).toBe(0.92)
    }
  })

  it('done event has inputTokens and outputTokens', () => {
    const event: StreamEvent = { type: 'done', inputTokens: 100, outputTokens: 200 }
    if (event.type === 'done') {
      expect(event.inputTokens).toBe(100)
      expect(event.outputTokens).toBe(200)
    }
  })

  it('error event has code and message', () => {
    const event: StreamEvent = {
      type: 'error',
      code: 'UPSTREAM_ERROR',
      message: 'provider unavailable',
    }
    if (event.type === 'error') {
      expect(event.code).toBe('UPSTREAM_ERROR')
    }
  })

  it('exhaustive switch on StreamEvent type compiles without fallthrough', () => {
    const handleEvent = (event: StreamEvent): string => {
      switch (event.type) {
        case 'text_delta':
          return event.content
        case 'tool_call':
          return event.toolName
        case 'tool_result':
          return String(event.toolCallId)
        case 'gate_required':
          return event.gateId
        case 'done':
          return String(event.outputTokens)
        case 'error':
          return event.message
      }
    }

    expect(handleEvent({ type: 'text_delta', content: 'hi' })).toBe('hi')
  })
})
