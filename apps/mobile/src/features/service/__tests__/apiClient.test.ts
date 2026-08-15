import { fetchHello, ServiceRequestError } from '../apiClient';

describe('fetchHello', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('validates and returns a successful response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        service: 'echowave-api',
        message: 'HelloWorld',
      }),
    } as Response);

    await expect(fetchHello('http://localhost:3001')).resolves.toEqual({
      ok: true,
      service: 'echowave-api',
      message: 'HelloWorld',
    });
  });

  it('rejects responses that violate the shared contract', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'unexpected' }),
    } as Response);

    await expect(fetchHello()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<ServiceRequestError>);
  });

  it('turns an aborted request into a timeout error', async () => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    const request = fetchHello('http://localhost:3001', 20);
    const rejection = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(20);

    await rejection;
  });
});
