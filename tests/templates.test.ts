import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listTemplates, getTemplate, applyTemplate } from '../src/workspace/templates.js';

const TEST_ROOT = join(tmpdir(), `tg-templates-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('Templates — listTemplates', () => {
  it('should return all templates', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(7);
  });

  it('should have required fields on each template', () => {
    for (const t of listTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Array.isArray(t.tags)).toBe(true);
      expect(Array.isArray(t.files)).toBe(true);
      expect(t.files.length).toBeGreaterThan(0);
    }
  });

  it('should include expected template IDs', () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids).toContain('node-typescript');
    expect(ids).toContain('python-fastapi');
    expect(ids).toContain('react-vite');
    expect(ids).toContain('mcp-server');
  });

  it('should filter by tag python', () => {
    const all = listTemplates().filter((t) => t.tags.includes('python'));
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const t of all) expect(t.tags).toContain('python');
  });

  it('should filter by tag mcp', () => {
    const all = listTemplates().filter((t) => t.tags.includes('mcp'));
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Templates — getTemplate', () => {
  it('should return a template by id', () => {
    const t = getTemplate('node-typescript');
    expect(t).not.toBeNull();
    expect(t!.id).toBe('node-typescript');
  });

  it('should return null for unknown id', () => {
    // @ts-expect-error testing invalid id
    expect(getTemplate('does-not-exist')).toBeNull();
  });
});

describe('Templates — applyTemplate', () => {
  it('should create files for node-typescript template', () => {
    const result = applyTemplate({
      templateId: 'node-typescript',
      projectName: 'my-app',
      targetDir: 'my-app',
      rootDir: TEST_ROOT,
    });

    expect(result.filesCreated.length).toBeGreaterThan(0);
    expect(result.projectName).toBe('my-app');
    expect(existsSync(join(result.targetDir, 'package.json'))).toBe(true);
    expect(existsSync(join(result.targetDir, 'tsconfig.json'))).toBe(true);
    expect(existsSync(join(result.targetDir, 'src/index.ts'))).toBe(true);
  });

  it('should interpolate project name into package.json', () => {
    applyTemplate({
      templateId: 'node-typescript',
      projectName: 'cool-project',
      targetDir: 'cool-project',
      rootDir: TEST_ROOT,
    });

    const pkg = JSON.parse(
      readFileSync(join(TEST_ROOT, 'cool-project', 'package.json'), 'utf-8'),
    ) as { name: string };
    expect(pkg.name).toBe('cool-project');
  });

  it('should sanitize project name', () => {
    const result = applyTemplate({
      templateId: 'node-javascript',
      projectName: 'My Cool App!!',
      targetDir: 'sanitized',
      rootDir: TEST_ROOT,
    });
    expect(result.projectName).toMatch(/^[a-z0-9._-]+$/);
  });

  it('should skip existing files when overwrite=false', () => {
    applyTemplate({
      templateId: 'node-typescript',
      projectName: 'test-app',
      targetDir: 'test-app',
      rootDir: TEST_ROOT,
    });

    // Apply again without overwrite
    const second = applyTemplate({
      templateId: 'node-typescript',
      projectName: 'test-app',
      targetDir: 'test-app',
      rootDir: TEST_ROOT,
      overwrite: false,
    });

    expect(second.filesSkipped.length).toBeGreaterThan(0);
    expect(second.filesCreated.length).toBe(0);
  });

  it('should overwrite existing files when overwrite=true', () => {
    applyTemplate({
      templateId: 'node-typescript',
      projectName: 'test-app',
      targetDir: 'test-app',
      rootDir: TEST_ROOT,
    });

    const second = applyTemplate({
      templateId: 'node-typescript',
      projectName: 'test-app',
      targetDir: 'test-app',
      rootDir: TEST_ROOT,
      overwrite: true,
    });

    expect(second.filesCreated.length).toBeGreaterThan(0);
    expect(second.filesSkipped.length).toBe(0);
  });

  it('should block path traversal outside workspace', () => {
    expect(() =>
      applyTemplate({
        templateId: 'node-typescript',
        projectName: 'evil',
        targetDir: '../../etc',
        rootDir: TEST_ROOT,
      }),
    ).toThrow(/outside the workspace/i);
  });

  it('should throw for unknown template id', () => {
    expect(() =>
      applyTemplate({
        // @ts-expect-error testing invalid id
        templateId: 'non-existent-template',
        projectName: 'test',
        targetDir: '.',
        rootDir: TEST_ROOT,
      }),
    ).toThrow(/Unknown template/i);
  });

  it('should create python-fastapi template correctly', () => {
    const result = applyTemplate({
      templateId: 'python-fastapi',
      projectName: 'my-api',
      targetDir: 'my-api',
      rootDir: TEST_ROOT,
    });

    expect(existsSync(join(result.targetDir, 'main.py'))).toBe(true);
    expect(existsSync(join(result.targetDir, 'requirements.txt'))).toBe(true);
  });

  it('should create mcp-server template correctly', () => {
    const result = applyTemplate({
      templateId: 'mcp-server',
      projectName: 'my-mcp',
      targetDir: 'my-mcp',
      rootDir: TEST_ROOT,
    });

    expect(existsSync(join(result.targetDir, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(result.targetDir, 'claude_desktop_config.example.json'))).toBe(true);

    const src = readFileSync(join(result.targetDir, 'src/index.ts'), 'utf-8');
    expect(src).toContain("name: 'my-mcp'");
  });

  it('should return postInstall commands', () => {
    const result = applyTemplate({
      templateId: 'node-typescript',
      projectName: 'test',
      targetDir: 'test',
      rootDir: TEST_ROOT,
    });
    expect(Array.isArray(result.postInstall)).toBe(true);
    expect(result.postInstall.length).toBeGreaterThan(0);
  });
});