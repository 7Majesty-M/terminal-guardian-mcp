// ============================================================
// Terminal Guardian MCP — AI Commit Message Generator
// Uses Anthropic API to generate conventional commit messages
// from git diff output
// ============================================================

export interface CommitSuggestion {
  message: string;       
  type: ConventionalType;   
  scope?: string | undefined;
  subject: string;         
  body?: string | undefined;
  breaking: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export type ConventionalType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'chore'
  | 'ci'
  | 'build'
  | 'revert';

export interface GenerateCommitOptions {
  diff: string;
  stagedFiles: string[];
  branch?: string | undefined;
  count?: number;
  style?: CommitStyle;
}

export type CommitStyle = 'conventional' | 'simple' | 'detailed';

export interface GenerateCommitResult {
  suggestions: CommitSuggestion[];
  model: string;
  tokensUsed?: number | undefined;
  diffSummary: string;
  truncated: boolean;
}

const MAX_DIFF_CHARS = 12_000;

const SYSTEM_PROMPT = `You are an expert software engineer generating git commit messages.
Analyze the provided git diff and generate clear, accurate commit messages.

Rules:
- Follow Conventional Commits specification: type(scope): subject
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build, revert
- Subject: imperative mood, lowercase, no period, max 72 chars
- Body: optional, explain WHY not WHAT, wrap at 72 chars
- Mark breaking changes with "BREAKING CHANGE:" in body
- Be specific and accurate to the actual changes
- Do not invent changes that aren't in the diff

Respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "suggestions": [
    {
      "type": "feat",
      "scope": "auth",
      "subject": "add JWT refresh token rotation",
      "body": "Implements automatic refresh token rotation on each use\\nto prevent token reuse attacks.",
      "breaking": false,
      "confidence": "high"
    }
  ],
  "diffSummary": "One-sentence summary of what changed"
}`;

export async function generateCommitMessages(
  options: GenerateCommitOptions,
): Promise<GenerateCommitResult> {
  const { diff, stagedFiles, branch, count = 3, style = 'conventional' } = options;

  if (!diff.trim()) {
    throw new Error('No diff provided. Stage some changes first with git add.');
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  const truncatedDiff = truncated ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[diff truncated...]' : diff;

  const userPrompt = buildUserPrompt(truncatedDiff, stagedFiles, branch, count, style);

  const response = await callAnthropicAPI(userPrompt);

  const parsed = parseAPIResponse(response.content);

  return {
    suggestions: parsed.suggestions.slice(0, count).map(formatSuggestion),
    model: response.model,
    tokensUsed: response.usage ? response.usage.input_tokens + response.usage.output_tokens : undefined,
    diffSummary: parsed.diffSummary ?? 'Changes analyzed',
    truncated,
  };
}

function buildUserPrompt(
  diff: string,
  files: string[],
  branch: string | undefined,
  count: number,
  style: CommitStyle,
): string {
  const fileList = files.length > 0
    ? `Changed files:\n${files.map((f) => `  - ${f}`).join('\n')}\n\n`
    : '';

  const branchHint = branch ? `Current branch: ${branch}\n\n` : '';

  const styleHint = style === 'simple'
    ? 'Generate simple, concise messages without body.'
    : style === 'detailed'
      ? 'Generate detailed messages with body explaining the why.'
      : 'Generate conventional commit messages.';

  return `${branchHint}${fileList}${styleHint}
Generate ${count} commit message suggestion${count > 1 ? 's' : ''} for this diff:

\`\`\`diff
${diff}
\`\`\``;
}

async function callAnthropicAPI(userPrompt: string): Promise<{
  content: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number } | undefined;
}> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(process.env['ANTHROPIC_API_KEY']
        ? { 'x-api-key': process.env['ANTHROPIC_API_KEY'] }
        : {}),
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'Anthropic API authentication failed. Set ANTHROPIC_API_KEY environment variable.',
      );
    }
    if (response.status === 429) {
      throw new Error('Anthropic API rate limit exceeded. Try again in a moment.');
    }
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage?: { input_tokens: number; output_tokens: number } | undefined;
  };

  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return { content: text, model: data.model, usage: data.usage };
}

function parseAPIResponse(raw: string): {
  suggestions: Array<{
    type: string;
    scope?: string | undefined;
    subject: string;
    body?: string | undefined;
    breaking: boolean;
    confidence: string;
  }>;
  diffSummary?: string | undefined;
} {
  const clean = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(clean) as ReturnType<typeof parseAPIResponse>;
  } catch {
    throw new Error(
      `Failed to parse AI response as JSON. Raw response: ${raw.slice(0, 300)}`,
    );
  }
}

function formatSuggestion(raw: {
  type: string;
  scope?: string | undefined;
  subject: string;
  body?: string | undefined;
  breaking: boolean;
  confidence: string;
}): CommitSuggestion {
  const type = (raw.type ?? 'chore') as ConventionalType;
  const scope = raw.scope?.trim() || undefined;
  const subject = raw.subject?.trim() ?? 'update code';
  const body = raw.body?.trim() || undefined;

  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  const breakingNote = raw.breaking ? '\nBREAKING CHANGE: ' : '';
  const message = body
    ? `${header}\n\n${body}${breakingNote}`
    : `${header}${breakingNote}`;

  return {
    message,
    type,
    scope,
    subject,
    body,
    breaking: raw.breaking ?? false,
    confidence: (['high', 'medium', 'low'].includes(raw.confidence)
      ? raw.confidence
      : 'medium') as CommitSuggestion['confidence'],
  };
}