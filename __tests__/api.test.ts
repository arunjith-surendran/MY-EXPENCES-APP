import { ApiError, request } from '../src/lib/api';

const respond = (status: number, body?: unknown) =>
  jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () =>
      body === undefined
        ? Promise.reject(new Error('no body'))
        : Promise.resolve(body),
  });

describe('request', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends JSON with the bearer token and returns the body', async () => {
    const fetchMock = respond(200, { id: 'u1' });
    globalThis.fetch = fetchMock;
    await expect(request('/users/me', { accessToken: 'abc' })).resolves.toEqual(
      { id: 'u1' },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/users\/me$/);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer abc');
  });

  it("surfaces the server's message and status", async () => {
    globalThis.fetch = respond(401, { message: 'Invalid Google token' });
    const error = await request<never>('/auth/google', {
      body: { idToken: 'x' },
    }).catch((e: ApiError) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Invalid Google token',
    });
    expect(error.isNetwork).toBe(false);
  });

  it('joins validation messages', async () => {
    globalThis.fetch = respond(400, {
      message: ['a is required', 'b is too long'],
    });
    await expect(request('/x', { body: {} })).rejects.toMatchObject({
      message: 'a is required\nb is too long',
    });
  });

  it('explains rate limiting', async () => {
    globalThis.fetch = respond(429, { message: 'ThrottlerException' });
    await expect(request('/x', { body: {} })).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('Too many attempts'),
    });
  });

  it('treats no connection as a network error (status 0)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));
    const error = await request<never>('/x').catch((e: ApiError) => e);
    expect(error).toMatchObject({ status: 0 });
    expect(error.isNetwork).toBe(true);
  });

  it('returns nothing for 204', async () => {
    globalThis.fetch = respond(204);
    await expect(
      request('/auth/logout', { body: {} }),
    ).resolves.toBeUndefined();
  });
});
