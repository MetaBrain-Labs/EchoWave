/** Validates the API response and converts transport failures into stable UI errors. */
import {
  HelloResponseSchema,
  type HelloResponse,
} from '@echowave/contracts';

export const apiUrl =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ??
  'http://localhost:3001';

export type ServiceErrorCode = 'INVALID_RESPONSE' | 'NETWORK' | 'TIMEOUT';

export class ServiceRequestError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceRequestError';
  }
}

export async function fetchHello(
  baseUrl = apiUrl,
  timeoutMs = 5_000,
): Promise<HelloResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/hello`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ServiceRequestError(
        'NETWORK',
        `API returned HTTP ${response.status}.`,
      );
    }

    const result = HelloResponseSchema.safeParse(await response.json());
    if (!result.success) {
      throw new ServiceRequestError(
        'INVALID_RESPONSE',
        'API response did not match the shared contract.',
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof ServiceRequestError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new ServiceRequestError('TIMEOUT', 'API request timed out.');
    }
    throw new ServiceRequestError(
      'NETWORK',
      error instanceof Error ? error.message : 'Unable to reach the API.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
