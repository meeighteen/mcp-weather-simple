# Weather MCP Server - Features Documentation

## Overview

This document outlines the three main features implemented in the Weather MCP Server: **Caching**, **Error Handling**, and **Rate Limiting**.

---

## 1. Caching Layer

### Purpose
Reduces redundant API calls by storing weather data in memory with automatic expiration.

### Configuration
- **Default TTL (Time-To-Live)**: 5 minutes (300 seconds)
- **Storage**: In-memory Map
- **Scope**: Per city (case-insensitive)

### How It Works
1. When a weather request is made for a city, the cache is checked first
2. If valid cached data exists (not expired), it's returned immediately
3. If no cache or cache is expired, fresh data is fetched from the API
4. Fresh data is stored in the cache for future requests

### Cache Key Format
```
weather:{city_name_lowercase}
```

### Example Response (Cached Data)
```json
{
  "current": {
    "temperature_2m": 22.5
  },
  "hourly": { ... },
  "_cached": true,
  "_cacheTime": "2026-08-15T20:02:25.304Z"
}
```

### Customization
To adjust cache TTL, modify the cache initialization in `src/main.ts`:

```typescript
// Current: 5 minutes
const weatherCache = new Cache(300);

// Change to 10 minutes
const weatherCache = new Cache(600);
```

### Benefits
- ✅ Faster response times for repeated queries
- ✅ Reduced load on external APIs
- ✅ Lower bandwidth usage
- ✅ Better performance during API outages (cached data still available)

---

## 2. Rate Limiting

### Purpose
Prevents abuse by limiting the number of requests per time window per city.

### Configuration
- **Default Limit**: 30 requests per 60 seconds per city
- **Tracking**: Per city (case-insensitive)
- **Window**: Rolling 60-second window

### How It Works
1. Each city maintains its own request counter
2. On each request, the system checks if the limit is exceeded
3. If limit not reached, request proceeds and counter increments
4. When the time window expires, the counter resets

### Rate Limit Exceeded Response
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests for city: London. Please try again later.",
  "remaining": 0
}
```

### Customization
To adjust rate limits, modify the initialization in `src/main.ts`:

```typescript
// Current: 30 requests per 60 seconds
const rateLimiter = new RateLimiter(30, 60);

// Change to 50 requests per 120 seconds
const rateLimiter = new RateLimiter(50, 120);
```

### Useful Methods
```typescript
// Check if request is allowed
rateLimiter.isAllowed("London") // returns boolean

// Get remaining requests for a city
rateLimiter.getRemainingRequests("London") // returns number
```

### Benefits
- ✅ Prevents API abuse
- ✅ Protects against DoS attacks
- ✅ Fair usage for multiple clients
- ✅ Protects external API quotas

---

## 3. Comprehensive Error Handling

### Purpose
Provides graceful error handling and meaningful error messages for various failure scenarios.

### Error Types Handled

#### 1. **Geocoding Service Unavailable**
```json
{
  "error": "Geocoding service unavailable",
  "message": "Failed to connect to geocoding service. Please try again later.",
  "details": "Error message from service"
}
```

#### 2. **Geocoding Service Error (HTTP Error)**
```json
{
  "error": "Geocoding service error",
  "status": 500,
  "message": "Failed to geocode city: London"
}
```

#### 3. **Invalid Geocoding Response**
```json
{
  "error": "Invalid response from geocoding service",
  "message": "Failed to parse geocoding response"
}
```

#### 4. **City Not Found**
```json
{
  "error": "City not found",
  "message": "No results found for city: XYZ123",
  "suggestions": "Please check spelling and try again"
}
```

#### 5. **Weather Service Unavailable**
```json
{
  "error": "Weather service unavailable",
  "message": "Failed to connect to weather service. Please try again later.",
  "details": "Error message from service"
}
```

#### 6. **Weather Service Error (HTTP Error)**
```json
{
  "error": "Weather service error",
  "status": 502,
  "message": "Failed to fetch weather data"
}
```

#### 7. **Invalid Weather Response**
```json
{
  "error": "Invalid response from weather service",
  "message": "Failed to parse weather response"
}
```

#### 8. **Unexpected Error (Catch-All)**
```json
{
  "error": "Unexpected error",
  "message": "An unexpected error occurred while fetching weather",
  "details": "Error message"
}
```

### Error Handling Features

#### Network Timeouts
- Each API call has a **5-second timeout**
- Prevents hanging requests
- Returns graceful error message

```typescript
// Timeout configuration
{ signal: AbortSignal.timeout(5000) } // 5000 milliseconds
```

#### Response Validation
- ✅ Checks HTTP status codes before parsing
- ✅ Validates JSON responses
- ✅ Verifies required data exists
- ✅ Provides specific error messages

#### Graceful Degradation
- Failed requests don't crash the server
- Cached data still available if used recently
- User always receives meaningful feedback

### Benefits
- ✅ No server crashes from network errors
- ✅ Clear error messages for debugging
- ✅ User-friendly error responses
- ✅ Helpful suggestions for users (e.g., check spelling)
- ✅ Detailed logs for developers

---

## Usage Examples

### Successful Request
```bash
curl -X POST http://localhost:3000/weather \
  -H "Content-Type: application/json" \
  -d '{"city": "London"}'
```

**Response (First Call - Fetched)**
```json
{
  "current": {
    "temperature_2m": 15.2,
    "time": "2026-08-15T19:50:00"
  },
  "hourly": {
    "time": ["2026-08-15T12:00", ...],
    "temperature_2m": [12.5, 13.0, ...]
  }
}
```

**Response (Second Call - Cached)**
```json
{
  "current": {
    "temperature_2m": 15.2,
    "time": "2026-08-15T19:50:00"
  },
  "hourly": {
    "time": ["2026-08-15T12:00", ...],
    "temperature_2m": [12.5, 13.0, ...]
  },
  "_cached": true,
  "_cacheTime": "2026-08-15T20:02:25.304Z"
}
```

### Rate Limited Request
After exceeding 30 requests in 60 seconds:
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests for city: London. Please try again later.",
  "remaining": 0
}
```

### Invalid City Request
```json
{
  "error": "City not found",
  "message": "No results found for city: XYZ123",
  "suggestions": "Please check spelling and try again"
}
```

---

## Configuration Summary

### Cache Settings
| Parameter | Default | Unit | Description |
|-----------|---------|------|-------------|
| TTL | 300 | seconds | Time before cache expires |

### Rate Limiter Settings
| Parameter | Default | Unit | Description |
|-----------|---------|------|-------------|
| Max Requests | 30 | requests | Max requests allowed in window |
| Window | 60 | seconds | Time window for rate limiting |

### API Timeout
| Parameter | Default | Unit | Description |
|-----------|---------|------|-------------|
| Timeout | 5000 | milliseconds | Max time for API calls |

---

## Implementation Details

### Class: Cache<T>
Generic in-memory cache with TTL support.

**Methods:**
- `get(key: string): T | null` - Retrieve cached value
- `set(key: string, data: T): void` - Store value in cache
- `clear(): void` - Clear all cached entries

### Class: RateLimiter
Tracks requests per key with time windows.

**Methods:**
- `isAllowed(key: string): boolean` - Check if request allowed
- `getRemainingRequests(key: string): number` - Get remaining requests

---

## Best Practices

### 1. Cache Management
- Monitor cache size in production (consider implementing LRU eviction)
- Adjust TTL based on data freshness requirements
- Clear cache manually if needed using `weatherCache.clear()`

### 2. Rate Limiting
- Adjust limits based on API quotas and expected traffic
- Consider implementing per-user rate limiting in future versions
- Log rate limit violations for abuse detection

### 3. Error Handling
- Always parse error responses for user feedback
- Log detailed errors server-side for debugging
- Implement retry logic in client applications

### 4. Monitoring
- Track cache hit/miss rates
- Monitor rate limit violations
- Log API errors for trend analysis
- Set up alerts for repeated failures

---

## Future Enhancements

- [ ] Persistent cache (Redis, database)
- [ ] Per-user rate limiting
- [ ] Cache warm-up strategies
- [ ] Advanced metrics and monitoring
- [ ] Configurable error responses
- [ ] Retry logic with exponential backoff
- [ ] LRU cache eviction policy
- [ ] Cache invalidation strategies

---

## Troubleshooting

### Cache Not Working?
- Verify TTL is set correctly
- Check that city names match (case-insensitive)
- Use `_cached` field in response to confirm cache hit

### Rate Limit Errors?
- Wait for the time window to reset (default 60 seconds)
- Reduce request frequency
- Contact support if limits are too restrictive

### Timeout Errors?
- Check network connectivity
- Verify external services are available
- Try again after a delay
- Check if rate limit is exceeded

### City Not Found?
- Verify correct spelling of city name
- Try with alternative city names or coordinates
- Check if city name is ambiguous (try state/country)

---

## Support

For issues, questions, or feature requests, please contact the development team or create an issue in the repository.

**Last Updated:** August 15, 2026
