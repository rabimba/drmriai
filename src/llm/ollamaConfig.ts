export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function hasHttpScheme(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isWildcardHost(hostname: string): boolean {
  return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
}

export function isLoopbackOllamaHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export function normalizeOllamaBaseUrl(value?: string): string {
  const trimmed = value?.trim() || DEFAULT_OLLAMA_URL;
  const withScheme = hasHttpScheme(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_OLLAMA_URL;
    }

    if (isWildcardHost(url.hostname)) {
      url.hostname = 'localhost';
    }

    if (!url.port && isLoopbackOllamaHost(url.hostname)) {
      url.port = '11434';
    }

    url.hash = '';
    url.search = '';

    let pathname = url.pathname.replace(/\/+$/, '');
    if (pathname === '/api') pathname = '';

    return `${url.origin}${pathname}`;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

export function getOllamaUrlProblem(value?: string): string | null {
  const normalized = normalizeOllamaBaseUrl(value);

  try {
    const url = new URL(normalized);
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isHttpsPage && url.protocol === 'http:' && !isLoopbackOllamaHost(url.hostname)) {
      return (
        'This hosted HTTPS page can only call HTTP Ollama on localhost or 127.0.0.1. ' +
        'Use http://localhost:11434, not 0.0.0.0 or a LAN IP, unless you expose Ollama through HTTPS.'
      );
    }
  } catch {
    return 'Invalid Ollama URL. Use http://localhost:11434.';
  }

  return null;
}
