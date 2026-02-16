function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, init);

      if (resp.ok) return resp;

      if (resp.status === 401) {
        throw new Error(`Authentication failed (${resp.status})`);
      }

      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`HTTP ${resp.status}`);
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
      }

      const body = await resp.text();
      throw new Error(`Provider error ${resp.status}: ${body.slice(0, 500)}`);
    } catch (err) {
      if (err instanceof TypeError || (err as NodeJS.ErrnoException)?.code === 'ECONNREFUSED') {
        lastError = err as Error;
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}
