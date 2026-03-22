let fallbackCounter = 0;

function getCryptoApi(): Crypto | undefined {
  if (typeof globalThis === "undefined" || !("crypto" in globalThis)) {
    return undefined;
  }
  return globalThis.crypto;
}

function createFallbackId(): string {
  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

export function generateSecureId(prefix?: string): string {
  const cryptoApi = getCryptoApi();
  const id =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : createFallbackId();
  return prefix ? `${prefix}-${id}` : id;
}

export function getSecureRandomInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError("getSecureRandomInt expects integer bounds where max >= min");
  }

  const cryptoApi = getCryptoApi();
  if (!cryptoApi) {
    return min;
  }

  const range = max - min + 1;
  const maxUint32 = 0xffffffff;
  const threshold = maxUint32 - ((maxUint32 + 1) % range);
  const value = new Uint32Array(1);

  do {
    cryptoApi.getRandomValues(value);
  } while (value[0] > threshold);

  return min + (value[0] % range);
}
