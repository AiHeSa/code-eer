import { realpath } from 'node:fs/promises';
import { AstService } from '../code-review/internal/ast/service.js';
import { repositoryRoot } from '../code-review/internal/ast/root.js';
import { createReviewServer } from './server.js';

const port = Number(process.env['CODE_EER_PORT'] ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CODE_EER_PORT must be 1–65535');
const root = await realpath(process.env['CODE_EER_PROJECT_ROOT'] ?? repositoryRoot());
const ast = new AstService();
const server = createReviewServer({ root, ast });
server.on('error', (error) => { console.error(error); ast.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(JSON.stringify({ event: 'listening', address: `http://127.0.0.1:${port}`, root })); });
function shutdown(): void {
  server.close(); server.closeAllConnections(); ast.close();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
