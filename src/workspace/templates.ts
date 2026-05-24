// ============================================================
// Terminal Guardian MCP — Workspace Templates
// Scaffold common project structures with best-practice configs
// ============================================================

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

export type TemplateId =
  | 'node-typescript'
  | 'node-javascript'
  | 'python-fastapi'
  | 'python-cli'
  | 'react-vite'
  | 'nextjs'
  | 'express-api'
  | 'mcp-server';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  tags: string[];
  files: TemplateFile[];
  postInstall?: string[] | undefined;
}

export interface TemplateFile {
  path: string;      
  content: string;
  executable?: boolean | undefined;
}

export interface ApplyTemplateOptions {
  templateId: TemplateId;
  projectName: string;
  targetDir: string;
  rootDir: string;
  overwrite?: boolean | undefined;
}

export interface ApplyTemplateResult {
  templateId: TemplateId;
  projectName: string;
  targetDir: string;
  filesCreated: string[];
  filesSkipped: string[];
  postInstall: string[];
}

// ─── Template Registry ────────────────────────────────────────

export const TEMPLATES: Record<TemplateId, Template> = {

  'node-typescript': {
    id: 'node-typescript',
    name: 'Node.js + TypeScript',
    description: 'Production-ready Node.js project with TypeScript, ESLint, Prettier, and Vitest',
    tags: ['node', 'typescript', 'backend'],
    postInstall: ['npm install', 'npm run build'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name,
          version: '0.1.0',
          type: 'module',
          scripts: {
            build: 'tsc',
            dev: 'tsx watch src/index.ts',
            start: 'node dist/index.js',
            test: 'vitest run',
            lint: 'eslint src --ext .ts',
            format: 'prettier --write "src/**/*.ts"',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {},
          devDependencies: {
            typescript: '^5.6.0',
            tsx: '^4.19.0',
            vitest: '^2.1.0',
            eslint: '^9.0.0',
            prettier: '^3.3.0',
            '@types/node': '^22.0.0',
          },
        }, null, 2),
      },
      {
        path: 'tsconfig.json',
        content: () => JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'Node16',
            moduleResolution: 'Node16',
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            declaration: true,
            sourceMap: true,
          },
          include: ['src/**/*'],
          exclude: ['node_modules', 'dist'],
        }, null, 2),
      },
      { path: 'src/index.ts', content: () => `// ${`Entry point`}\n\nasync function main(): Promise<void> {\n  console.log('Hello, World!');\n}\n\nmain().catch(console.error);\n` },
      { path: 'src/index.test.ts', content: () => `import { describe, it, expect } from 'vitest';\n\ndescribe('example', () => {\n  it('should pass', () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n` },
      { path: '.gitignore', content: () => 'node_modules/\ndist/\ncoverage/\n*.log\n.env\n.env.local\n' },
      { path: '.prettierrc', content: () => JSON.stringify({ semi: true, singleQuote: true, trailingComma: 'all', printWidth: 100 }, null, 2) },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n## Development\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'node-javascript': {
    id: 'node-javascript',
    name: 'Node.js + JavaScript (ESM)',
    description: 'Lightweight Node.js project with ESM modules and Jest',
    tags: ['node', 'javascript', 'backend'],
    postInstall: ['npm install'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name, version: '0.1.0', type: 'module',
          scripts: { start: 'node src/index.js', test: 'node --test', dev: 'node --watch src/index.js' },
          dependencies: {},
          devDependencies: {},
        }, null, 2),
      },
      { path: 'src/index.js', content: () => `// Entry point\nconsole.log('Hello, World!');\n` },
      { path: '.gitignore', content: () => 'node_modules/\n*.log\n.env\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n\`\`\`bash\nnode src/index.js\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'python-fastapi': {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    description: 'Modern async Python API with FastAPI, Pydantic v2, and pytest',
    tags: ['python', 'api', 'fastapi', 'backend'],
    postInstall: ['python -m venv .venv', 'pip install -r requirements.txt'],
    files: [
      {
        path: 'requirements.txt',
        content: () => 'fastapi>=0.115.0\nuvicorn[standard]>=0.31.0\npydantic>=2.9.0\nhttpx>=0.27.0\npytest>=8.3.0\npytest-asyncio>=0.24.0\n',
      },
      {
        path: 'main.py',
        content: (name: string) => `from fastapi import FastAPI\n\napp = FastAPI(title="${name}", version="0.1.0")\n\n\n@app.get("/")\nasync def root() -> dict[str, str]:\n    return {"message": "Hello, World!"}\n\n\n@app.get("/health")\nasync def health() -> dict[str, str]:\n    return {"status": "ok"}\n`,
      },
      {
        path: 'tests/test_main.py',
        content: () => `import pytest\nfrom httpx import AsyncClient, ASGITransport\nfrom main import app\n\n\n@pytest.mark.asyncio\nasync def test_root():\n    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:\n        response = await client.get("/")\n    assert response.status_code == 200\n`,
      },
      { path: 'tests/__init__.py', content: () => '' },
      { path: '.gitignore', content: () => '__pycache__/\n*.pyc\n.venv/\n.env\n*.egg-info/\ndist/\n.pytest_cache/\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n## Run\n\n\`\`\`bash\nuvicorn main:app --reload\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'python-cli': {
    id: 'python-cli',
    name: 'Python CLI Tool',
    description: 'Python CLI application with Typer, Rich output, and pytest',
    tags: ['python', 'cli', 'tool'],
    postInstall: ['python -m venv .venv', 'pip install -e ".[dev]"'],
    files: [
      {
        path: 'pyproject.toml',
        content: (name: string) => `[build-system]\nrequires = ["setuptools>=74"]\nbuild-backend = "setuptools.backends.legacy:build"\n\n[project]\nname = "${name}"\nversion = "0.1.0"\ndependencies = ["typer>=0.13.0", "rich>=13.9.0"]\n\n[project.optional-dependencies]\ndev = ["pytest>=8.3.0", "pytest-cov>=5.0.0"]\n\n[project.scripts]\n${name} = "${name.replace(/-/g, '_')}.cli:app"\n`,
      },
      {
        path: `src/cli.py`,
        content: (name: string) => `import typer\nfrom rich.console import Console\n\napp = typer.Typer(help="${name} CLI")\nconsole = Console()\n\n\n@app.command()\ndef hello(name: str = typer.Argument("World")) -> None:\n    """Say hello."""\n    console.print(f"[bold green]Hello, {name}![/bold green]")\n\n\nif __name__ == "__main__":\n    app()\n`,
      },
      { path: '.gitignore', content: () => '__pycache__/\n*.pyc\n.venv/\n.env\ndist/\n*.egg-info/\n.pytest_cache/\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n\`\`\`bash\npython src/cli.py hello\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'react-vite': {
    id: 'react-vite',
    name: 'React + Vite + TypeScript',
    description: 'Modern React SPA with Vite, TypeScript, and Tailwind CSS',
    tags: ['react', 'frontend', 'typescript', 'vite'],
    postInstall: ['npm install', 'npm run dev'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name, version: '0.1.0', type: 'module',
          scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview', lint: 'eslint src' },
          dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' },
          devDependencies: {
            '@types/react': '^18.3.0', '@types/react-dom': '^18.3.0',
            '@vitejs/plugin-react': '^4.3.0', typescript: '^5.6.0', vite: '^5.4.0',
          },
        }, null, 2),
      },
      { path: 'vite.config.ts', content: () => `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n` },
      { path: 'tsconfig.json', content: () => JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, noEmit: true }, include: ['src'] }, null, 2) },
      { path: 'index.html', content: (name: string) => `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8" /><title>${name}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n` },
      { path: 'src/main.tsx', content: () => `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode><App /></React.StrictMode>\n);\n` },
      { path: 'src/App.tsx', content: (name: string) => `export default function App() {\n  return <h1>${name}</h1>;\n}\n` },
      { path: '.gitignore', content: () => 'node_modules/\ndist/\n*.log\n.env\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n\`\`\`bash\nnpm install && npm run dev\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'nextjs': {
    id: 'nextjs',
    name: 'Next.js + TypeScript',
    description: 'Next.js App Router project with TypeScript and Tailwind CSS',
    tags: ['nextjs', 'react', 'frontend', 'typescript', 'fullstack'],
    postInstall: ['npm install', 'npm run dev'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name, version: '0.1.0',
          scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
          dependencies: { next: '^15.0.0', react: '^18.3.0', 'react-dom': '^18.3.0' },
          devDependencies: { typescript: '^5.6.0', '@types/node': '^22.0.0', '@types/react': '^18.3.0', tailwindcss: '^3.4.0' },
        }, null, 2),
      },
      { path: 'tsconfig.json', content: () => JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, moduleResolution: 'bundler', module: 'esnext', jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'], exclude: ['node_modules'] }, null, 2) },
      { path: 'next.config.ts', content: () => `import type { NextConfig } from 'next';\n\nconst config: NextConfig = {};\n\nexport default config;\n` },
      { path: 'app/layout.tsx', content: (name: string) => `export const metadata = { title: '${name}' };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n` },
      { path: 'app/page.tsx', content: (name: string) => `export default function Home() {\n  return <main><h1>${name}</h1></main>;\n}\n` },
      { path: '.gitignore', content: () => 'node_modules/\n.next/\nout/\n*.log\n.env*\n!.env.example\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n\`\`\`bash\nnpm install && npm run dev\n\`\`\`\n` },
    ].map(normalizeFile),
  },

  'express-api': {
    id: 'express-api',
    name: 'Express.js REST API',
    description: 'Express.js REST API with TypeScript, Zod validation, and Jest',
    tags: ['node', 'express', 'api', 'typescript', 'backend'],
    postInstall: ['npm install', 'npm run dev'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name, version: '0.1.0', type: 'module',
          scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js', test: 'vitest run' },
          dependencies: { express: '^4.21.0', zod: '^3.23.0' },
          devDependencies: { '@types/express': '^5.0.0', typescript: '^5.6.0', tsx: '^4.19.0', vitest: '^2.1.0', '@types/node': '^22.0.0' },
        }, null, 2),
      },
      { path: 'tsconfig.json', content: () => JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: './dist', rootDir: './src', strict: true, esModuleInterop: true, skipLibCheck: true }, include: ['src/**/*'] }, null, 2) },
      {
        path: 'src/index.ts',
        content: (name: string) => `import express from 'express';\n\nconst app = express();\nconst PORT = process.env['PORT'] ?? 3000;\n\napp.use(express.json());\n\napp.get('/health', (_req, res) => {\n  res.json({ status: 'ok', service: '${name}' });\n});\n\napp.listen(PORT, () => {\n  console.log(\`🚀 ${name} running on port \${PORT}\`);\n});\n\nexport { app };\n`,
      },
      { path: '.gitignore', content: () => 'node_modules/\ndist/\n*.log\n.env\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\n\`\`\`bash\nnpm install && npm run dev\n\`\`\`\n\n## Endpoints\n\n- \`GET /health\` — Health check\n` },
    ].map(normalizeFile),
  },

  'mcp-server': {
    id: 'mcp-server',
    name: 'MCP Server (TypeScript)',
    description: 'Model Context Protocol server template with TypeScript and the official MCP SDK',
    tags: ['mcp', 'ai', 'typescript', 'anthropic'],
    postInstall: ['npm install', 'npm run build'],
    files: [
      {
        path: 'package.json',
        content: (name: string) => JSON.stringify({
          name, version: '0.1.0', type: 'module',
          bin: { [name]: 'dist/index.js' },
          scripts: { build: 'tsc', dev: 'tsx watch src/index.ts', start: 'node dist/index.js', test: 'vitest run', typecheck: 'tsc --noEmit' },
          dependencies: { '@modelcontextprotocol/sdk': '^1.0.0', zod: '^3.23.0' },
          devDependencies: { typescript: '^5.6.0', tsx: '^4.19.0', vitest: '^2.1.0', '@types/node': '^22.0.0' },
        }, null, 2),
      },
      { path: 'tsconfig.json', content: () => JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: './dist', rootDir: './src', strict: true, esModuleInterop: true, skipLibCheck: true, declaration: true }, include: ['src/**/*'], exclude: ['node_modules', 'dist'] }, null, 2) },
      {
        path: 'src/index.ts',
        content: (name: string) => `#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: '${name}', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'hello',
      description: 'Say hello',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name to greet' } },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'hello') {
    const who = (args as { name?: string })?.name ?? 'World';
    return { content: [{ type: 'text', text: \`Hello, \${who}!\` }] };
  }
  return { content: [{ type: 'text', text: \`Unknown tool: \${name}\` }], isError: true };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('${name} MCP server started\\n');
}

main().catch((err) => {
  process.stderr.write(\`Fatal: \${err instanceof Error ? err.message : String(err)}\\n\`);
  process.exit(1);
});
`,
      },
      {
        path: 'claude_desktop_config.example.json',
        content: (name: string) => JSON.stringify({
          mcpServers: {
            [name]: { command: 'node', args: ['dist/index.js'] },
          },
        }, null, 2),
      },
      { path: '.gitignore', content: () => 'node_modules/\ndist/\n*.log\n.env\n' },
      { path: 'README.md', content: (name: string) => `# ${name}\n\nA Model Context Protocol server.\n\n## Build\n\n\`\`\`bash\nnpm install && npm run build\n\`\`\`\n\n## Claude Desktop\n\nSee \`claude_desktop_config.example.json\`.\n` },
    ].map(normalizeFile),
  },

};

// ─── Helpers ──────────────────────────────────────────────────

function normalizeFile(f: { path: string; content: string | ((name: string) => string); executable?: boolean | undefined }): TemplateFile {
  return {
    path: f.path,
    content: typeof f.content === 'function' ? f.content('__PROJECT_NAME__') : f.content,
    executable: f.executable,
  };
}

// ─── Public API ───────────────────────────────────────────────

export function listTemplates(): Template[] {
  return Object.values(TEMPLATES);
}

export function getTemplate(id: TemplateId): Template | null {
  return TEMPLATES[id] ?? null;
}

export function applyTemplate(options: ApplyTemplateOptions): ApplyTemplateResult {
  const { templateId, projectName, targetDir, rootDir, overwrite = false } = options;

  const safeName = projectName.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();

  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(rootDir, targetDir);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Target directory "${targetDir}" is outside the workspace root`);
  }

  const template = TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown template: "${templateId}". Available: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];

  mkdirSync(resolvedTarget, { recursive: true });

  for (const file of template.files) {
    const content = file.content.replace(/__PROJECT_NAME__/g, safeName);
    const filePath = join(resolvedTarget, file.path);
    const fileDir = join(filePath, '..');

    mkdirSync(fileDir, { recursive: true });

    if (existsSync(filePath) && !overwrite) {
      filesSkipped.push(file.path);
      continue;
    }

    writeFileSync(filePath, content, { encoding: 'utf-8', mode: file.executable ? 0o755 : 0o644 });
    filesCreated.push(file.path);
  }

  return {
    templateId,
    projectName: safeName,
    targetDir: resolvedTarget,
    filesCreated,
    filesSkipped,
    postInstall: template.postInstall ?? [],
  };
}