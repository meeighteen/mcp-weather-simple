import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
    name: "server-mcp-example",
    version: "1.0.0",
});

// ============= CACHING LAYER =============
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

class Cache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private ttl: number; // milliseconds

    constructor(ttlSeconds: number = 300) {
        this.ttl = ttlSeconds * 1000; // Convert to milliseconds
    }

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        const isExpired = Date.now() - entry.timestamp > this.ttl;
        if (isExpired) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    set(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    clear(): void {
        this.cache.clear();
    }
}

// ============= RATE LIMITING =============
interface RateLimitEntry {
    count: number;
    resetTime: number;
}

class RateLimiter {
    private limits = new Map<string, RateLimitEntry>();
    private maxRequests: number;
    private windowSeconds: number;

    constructor(maxRequests: number = 30, windowSeconds: number = 60) {
        this.maxRequests = maxRequests;
        this.windowSeconds = windowSeconds;
    }

    isAllowed(key: string): boolean {
        const now = Date.now();
        const entry = this.limits.get(key);

        if (!entry || now > entry.resetTime) {
            this.limits.set(key, {
                count: 1,
                resetTime: now + this.windowSeconds * 1000,
            });
            return true;
        }

        if (entry.count < this.maxRequests) {
            entry.count++;
            return true;
        }

        return false;
    }

    getRemainingRequests(key: string): number {
        const entry = this.limits.get(key);
        if (!entry || Date.now() > entry.resetTime) {
            return this.maxRequests;
        }
        return Math.max(0, this.maxRequests - entry.count);
    }
}

// ============= INITIALIZATION =============
const weatherCache = new Cache(300); // 5 minutes TTL
const rateLimiter = new RateLimiter(30, 60); // 30 requests per 60 seconds per city

server.registerTool(
    'fetch-weather',
    {
        description: 'Fetches the current weather for a given city.',
        inputSchema: {
            city: z.string().describe('City name'),
        },
    },
    async ({ city }) => {
        try {
            // Rate limiting check
            if (!rateLimiter.isAllowed(city)) {
                const remaining = rateLimiter.getRemainingRequests(city);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Rate limit exceeded',
                                    message: `Too many requests for city: ${city}. Please try again later.`,
                                    remaining: remaining,
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            // Check cache first
            const cacheKey = `weather:${city.toLowerCase()}`;
            const cachedWeather = weatherCache.get(cacheKey);
            
            if (cachedWeather) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    ...cachedWeather,
                                    _cached: true,
                                    _cacheTime: new Date().toISOString(),
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            // Fetch geocoding data with error handling
            let geocoded_city_response: Response;
            try {
                geocoded_city_response = await fetch(
                    'https://geocoding-api.open-meteo.com/v1/search?name=' +
                    encodeURIComponent(city) +
                    '&count=10&language=en&format=json',
                    { signal: AbortSignal.timeout(5000) } // 5 second timeout
                );
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Geocoding service unavailable',
                                    message: 'Failed to connect to geocoding service. Please try again later.',
                                    details: error instanceof Error ? error.message : String(error),
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            if (!geocoded_city_response.ok) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Geocoding service error',
                                    status: geocoded_city_response.status,
                                    message: `Failed to geocode city: ${city}`,
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            let data: any;
            try {
                data = await geocoded_city_response.json();
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Invalid response from geocoding service',
                                    message: 'Failed to parse geocoding response',
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            if (!data.results || data.results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'City not found',
                                    message: `No results found for city: ${city}`,
                                    suggestions: 'Please check spelling and try again',
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            const { latitude, longitude } = data.results[0];

            // Fetch weather data with error handling
            let weather_response: Response;
            try {
                weather_response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m&current=temperature_2m`,
                    { signal: AbortSignal.timeout(5000) } // 5 second timeout
                );
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Weather service unavailable',
                                    message: 'Failed to connect to weather service. Please try again later.',
                                    details: error instanceof Error ? error.message : String(error),
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            if (!weather_response.ok) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Weather service error',
                                    status: weather_response.status,
                                    message: 'Failed to fetch weather data',
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            let weather_data: any;
            try {
                weather_data = await weather_response.json();
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    error: 'Invalid response from weather service',
                                    message: 'Failed to parse weather response',
                                },
                                null,
                                2
                            ),
                        }
                    ]
                };
            }

            // Cache the successful response
            weatherCache.set(cacheKey, weather_data);

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(weather_data, null, 2),
                    }
                ]
            };
        } catch (error) {
            // Catch-all for unexpected errors
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            {
                                error: 'Unexpected error',
                                message: 'An unexpected error occurred while fetching weather',
                                details: error instanceof Error ? error.message : String(error),
                            },
                            null,
                            2
                        ),
                    }
                ]
            };
        }
    }
);

const transport = new StdioServerTransport();

await server.connect(transport);