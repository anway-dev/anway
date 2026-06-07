import { describe, it, expect, vi } from 'vitest'
import { createPostgresQueryFn } from './postgres-query.js'
import type { PgPoolLike } from './postgres-query.js'

describe('createPostgresQueryFn', () => {
  it('calls pool.query with sql and params', async () => {
    const mockRows = [{ id: '1', name: 'test' }]
    const mockPool: PgPoolLike = {
      query: vi.fn().mockResolvedValue({ rows: mockRows }),
    }

    const queryFn = createPostgresQueryFn(mockPool)
    const result = await queryFn('SELECT * FROM test WHERE id = $1', ['1'])

    expect(mockPool.query).toHaveBeenCalledTimes(1)
    expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', ['1'])
    expect(result).toEqual(mockRows)
  })

  it('passes empty params array when not provided', async () => {
    const mockPool: PgPoolLike = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }

    const queryFn = createPostgresQueryFn(mockPool)
    await queryFn('SELECT 1')

    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1', [])
  })

  it('returns empty array for no rows', async () => {
    const mockPool: PgPoolLike = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }

    const queryFn = createPostgresQueryFn(mockPool)
    const result = await queryFn('SELECT 1')

    expect(result).toEqual([])
  })
})
