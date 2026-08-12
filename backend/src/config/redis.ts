import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err: Error) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

// Cache-aside helper for the read-heavy aggregation endpoints (dashboard
// stats, daily/monthly/yearly summaries) - these hit Postgres GROUP BY
// queries on every dashboard load, and the per-plant-section split doubled
// how many of them fire at once. A short TTL keeps numbers fresh (summaries
// are updated live off MQTT) while absorbing the burst of near-simultaneous
// requests a page load/reload produces. Falls back to calling fn() directly
// on any Redis error, so an unreachable cache degrades to "no cache" instead
// of breaking the API.
export async function cacheWrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached != null) return JSON.parse(cached) as T;
  } catch (err) {
    console.error('[Redis] Get failed, bypassing cache:', (err as Error).message);
  }

  const result = await fn();

  try {
    await redis.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  } catch (err) {
    console.error('[Redis] Set failed:', (err as Error).message);
  }

  return result;
}

export default redis;
