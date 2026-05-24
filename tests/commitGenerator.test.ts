import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCommitMessages } from '../src/git/commitGenerator.js';

// Mock global fetch to avoid real API calls in tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeMockResponse(suggestions: unknown[], diffSummary = 'Test changes'): Response {
  const body = JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify({ suggestions, diffSummary }) }],
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const SAMPLE_DIFF = `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,12 @@ export class AuthService {
+  async refreshToken(token: string): Promise<string> {
+    const payload = this.verify(token);
+    return this.sign({ userId: payload.userId });
+  }
`;

describe('CommitGenerator', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env['ANTHROPIC_API_KEY'] = 'test-key-123';
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });

  describe('generateCommitMessages', () => {
    it('should return commit suggestions from API', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        { type: 'feat', scope: 'auth', subject: 'add refresh token rotation', body: null, breaking: false, confidence: 'high' },
        { type: 'feat', scope: 'auth', subject: 'implement JWT refresh', body: null, breaking: false, confidence: 'medium' },
      ]));

      const result = await generateCommitMessages({
        diff: SAMPLE_DIFF,
        stagedFiles: ['src/auth.ts'],
        branch: 'feature/refresh-tokens',
        count: 2,
      });

      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]!.type).toBe('feat');
      expect(result.suggestions[0]!.scope).toBe('auth');
      expect(result.suggestions[0]!.message).toContain('feat(auth):');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.truncated).toBe(false);
    });

    it('should format full conventional commit message correctly', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        {
          type: 'fix',
          scope: 'api',
          subject: 'handle null response from upstream',
          body: 'Upstream occasionally returns null on timeout.\nAdded null check to prevent crash.',
          breaking: false,
          confidence: 'high',
        },
      ]));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] });
      const msg = result.suggestions[0]!.message;

      expect(msg).toMatch(/^fix\(api\): handle null response from upstream/);
      expect(msg).toContain('Upstream occasionally returns null');
    });

    it('should mark breaking changes', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        { type: 'feat', scope: 'auth', subject: 'remove legacy token format', body: 'Old tokens no longer accepted.', breaking: true, confidence: 'high' },
      ]));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] });
      expect(result.suggestions[0]!.breaking).toBe(true);
      expect(result.suggestions[0]!.message).toContain('BREAKING CHANGE:');
    });

    it('should respect count limit', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        { type: 'feat', subject: 'suggestion 1', breaking: false, confidence: 'high' },
        { type: 'fix', subject: 'suggestion 2', breaking: false, confidence: 'medium' },
        { type: 'chore', subject: 'suggestion 3', breaking: false, confidence: 'low' },
        { type: 'docs', subject: 'suggestion 4', breaking: false, confidence: 'low' },
      ]));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [], count: 2 });
      expect(result.suggestions).toHaveLength(2);
    });

    it('should truncate large diffs', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        { type: 'chore', subject: 'large refactor', breaking: false, confidence: 'low' },
      ]));

      const hugeDiff = 'x'.repeat(15_000);
      const result = await generateCommitMessages({ diff: hugeDiff, stagedFiles: [] });
      expect(result.truncated).toBe(true);
    });

    it('should throw on empty diff', async () => {
      await expect(
        generateCommitMessages({ diff: '', stagedFiles: [] }),
      ).rejects.toThrow(/no diff/i);
    });

    it('should throw on 401 API error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      await expect(
        generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/i);
    });

    it('should throw on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }));
      await expect(
        generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] }),
      ).rejects.toThrow(/rate limit/i);
    });

    it('should handle API response with markdown fences', async () => {
      const body = JSON.stringify({
        content: [{ type: 'text', text: '```json\n{"suggestions":[{"type":"feat","subject":"add feature","breaking":false,"confidence":"high"}],"diffSummary":"test"}\n```' }],
        model: 'claude-sonnet-4-20250514',
      });
      mockFetch.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] });
      expect(result.suggestions[0]!.type).toBe('feat');
    });

    it('should include diffSummary in result', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse(
        [{ type: 'feat', subject: 'add feature', breaking: false, confidence: 'high' }],
        'Added refresh token rotation to auth service',
      ));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] });
      expect(result.diffSummary).toBe('Added refresh token rotation to auth service');
    });

    it('should report tokensUsed', async () => {
      mockFetch.mockResolvedValueOnce(makeMockResponse([
        { type: 'feat', subject: 'add feature', breaking: false, confidence: 'high' },
      ]));

      const result = await generateCommitMessages({ diff: SAMPLE_DIFF, stagedFiles: [] });
      expect(result.tokensUsed).toBe(150); // 100 input + 50 output
    });
  });
});