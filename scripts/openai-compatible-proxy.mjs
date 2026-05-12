#!/usr/bin/env node

import http from 'node:http';

const DEFAULT_PORT = 8787;
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://rabimba.github.io',
];

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return undefined;
}

function normalizeBaseUrl(value) {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

function parseOrigins(value) {
  return (value ? value.split(',') : DEFAULT_ORIGINS)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin, allowedOrigins) {
  return Boolean(origin) && (allowedOrigins.includes('*') || allowedOrigins.includes(origin));
}

function corsHeaders(origin, allowedOrigins) {
  const allowedOrigin = isAllowedOrigin(origin, allowedOrigins) ? origin : allowedOrigins[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function sendJson(res, status, payload, origin, allowedOrigins) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders(origin, allowedOrigins),
  });
  res.end(JSON.stringify(payload));
}

function buildTargetUrl(targetBaseUrl, requestUrl) {
  const localUrl = new URL(requestUrl, 'http://localhost');
  let pathname = localUrl.pathname;
  if (targetBaseUrl.endsWith('/v1') && pathname.startsWith('/v1/')) {
    pathname = pathname.slice(3);
  }
  if (pathname === '/') pathname = '';
  return `${targetBaseUrl}${pathname}${localUrl.search}`;
}

const targetBaseUrl = normalizeBaseUrl(readArg('target') ?? process.env.OPENAI_COMPAT_PROXY_TARGET);
const port = Number(readArg('port') ?? process.env.OPENAI_COMPAT_PROXY_PORT ?? DEFAULT_PORT);
const allowedOrigins = parseOrigins(readArg('origins') ?? process.env.OPENAI_COMPAT_PROXY_ORIGINS);

if (!targetBaseUrl) {
  console.error('Missing target. Use --target https://your-gateway.example.com/v1 or OPENAI_COMPAT_PROXY_TARGET.');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin, allowedOrigins));
    res.end();
    return;
  }

  if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
    sendJson(res, 403, { error: `Origin ${origin} is not allowed by this proxy.` }, origin, allowedOrigins);
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    sendJson(res, 200, { ok: true, target: targetBaseUrl }, origin, allowedOrigins);
    return;
  }

  try {
    const targetUrl = buildTargetUrl(targetBaseUrl, req.url ?? '/');
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key.toLowerCase() === 'host' || key.toLowerCase() === 'origin') continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      duplex: 'half',
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');
    for (const [key, value] of Object.entries(corsHeaders(origin, allowedOrigins))) {
      responseHeaders.set(key, value);
    }

    res.writeHead(upstream.status, Object.fromEntries(responseHeaders.entries()));
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (error) {
    sendJson(
      res,
      502,
      { error: error instanceof Error ? error.message : 'Proxy request failed' },
      origin,
      allowedOrigins,
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`OpenAI-compatible proxy listening on http://localhost:${port}`);
  console.log(`Forwarding to ${targetBaseUrl}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Use http://localhost:${port} as the OpenAI-compatible endpoint in Dr.MRI.AI Settings.`);
});
