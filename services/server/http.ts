import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export function sendJson(response: ServerResponse, status: number, result: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    const body = JSON.stringify(result);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
    if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
        throw new HttpError(415, 'CONTENT_TYPE', 'Use application/json');
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > 1024 * 1024) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'Request exceeds 1 MiB');
        parts.push(Buffer.from(chunk));
    }
    try {
        return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
    } catch {
        throw new HttpError(400, 'INVALID_JSON', 'Request must contain valid JSON');
    }
}

export function checkLocalRequest(request: IncomingMessage): void {
    const address = request.socket.localAddress;
    const port = request.socket.localPort;
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!address || !allowed.includes(request.headers.host ?? ''))
        throw new HttpError(403, 'HOST_NOT_ALLOWED', 'Use the local service address');
    if (request.headers.origin && !allowed.some((host) => request.headers.origin === `http://${host}`))
        throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Cross-origin requests are not accepted');
}
