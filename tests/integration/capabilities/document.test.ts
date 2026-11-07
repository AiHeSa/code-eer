import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    parseCapabilityDocument,
    resolveDocument,
} from '../../../services/code-review/internal/capabilities/document.js';

const common = parseCapabilityDocument(
    'rules/review.md',
    '# Review\n\n## parse\nCommon parsing.\n\n## count\nCommon count.\n',
);
const special = (body: string) =>
    parseCapabilityDocument('rules/review.go.md', `---\nextends: ./review.md\n---\n# Go\n\n${body}`);

test('Markdown routing retains common entries and overrides matching entries in common order', () => {
    assert.equal(
        resolveDocument(common, special('## parse\nGo parsing.\n')),
        '# Review\n\n## parse\nGo parsing.\n\n## count\nCommon count.\n',
    );
    assert.equal(resolveDocument(common, special('')), resolveDocument(common));
});

test('Markdown routing rejects extra entries and unrelated inheritance', () => {
    assert.throws(() => resolveDocument(common, special('## unexpected\nExtra.')), /unknown common entries/);
    const wrong = parseCapabilityDocument('rules/review.go.md', '---\nextends: ./other.md\n---\n## parse\nGo.');
    assert.throws(() => resolveDocument(common, wrong), /declare extends/);
});

test('fenced examples preserve content without introducing entries', () => {
    const source =
        '## parse\r\n~~~md\r\n## example\r\n~~~info\r\n## still-example\r\n~~~~\r\n\r\n## count\r\nCount.\r\n';
    const document = parseCapabilityDocument('rules/review.md', source);
    assert.deepEqual([...document.entries.keys()], ['parse', 'count']);
    assert.ok(document.entries.get('parse')!.includes('## still-example'));
});

test('Markdown entry identifiers and inheritance declarations remain unique', () => {
    assert.throws(() => special('## parse\nOne\n## parse\nTwo'), /duplicate document entry/);
    assert.throws(() => special('## Parse source\nText'), /stable entry identifiers/);
    assert.throws(
        () => parseCapabilityDocument('s.go.md', '---\nextends: ./s.md\nextends: ./other.md\n---'),
        /duplicate extends/,
    );
});
