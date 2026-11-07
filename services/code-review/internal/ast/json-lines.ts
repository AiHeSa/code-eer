import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { MAX_MESSAGE_BYTES, ProtocolError } from './protocol.js';

export function readLines(
    stream: Readable,
    onLine: (line: string) => void,
    onError: (error: Error) => void,
    limit = MAX_MESSAGE_BYTES,
): void {
    // 多字节字符可能被流分片切开；先增量解码，再按行分帧，并以字节执行限额。
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let stopped = false;
    const consume = (chunk: string) => {
        if (stopped) return;
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (Buffer.byteLength(line) > limit) return stop();
            if (line.trim()) onLine(line);
        }
        if (Buffer.byteLength(buffer) > limit) stop();
    };
    const stop = () => {
        stopped = true;
        onError(new ProtocolError('MESSAGE_TOO_LARGE', `Message exceeds ${limit} bytes`));
    };
    stream.on('data', (chunk: Buffer) => consume(decoder.write(chunk)));
    stream.on('error', onError);
    stream.on('end', () => {
        consume(decoder.end());
        if (!stopped && buffer.trim())
            onError(new ProtocolError('TRUNCATED_MESSAGE', 'Expected a newline at end of message'));
    });
}

export function encodeLine(value: unknown): string {
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES)
        throw new ProtocolError('MESSAGE_TOO_LARGE', 'Outgoing message exceeds limit');
    return line;
}
