import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyChanges, findSkills, inspectSkill, planChange } from '../src/skills.mjs';
import { translateBatch } from '../src/translation.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const testRoot = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const markdown = '---\nname: skill-creator\ndescription: Use when creating or updating a skill.\n---\n\nKeep these instructions.\n';
const short = '  short_description: "Create or update a skill"\n';
const yaml = 'interface:\n  display_name: Skill Creator\n' + short + 'policy:\n  allow_implicit_invocation: false\n';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(testRoot, '.test-tmp-'));
  const scope = path.join(root, 'skills');
  const skill = path.join(scope, 'example');
  fs.mkdirSync(path.join(skill, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), markdown);
  fs.writeFileSync(path.join(skill, 'agents', 'openai.yaml'), yaml);
  t.after(() => {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) === testRoot && path.basename(resolved).startsWith('.test-tmp-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  return { root, scope, skill, target: path.join(skill, 'agents', 'openai.yaml') };
}

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, CODEX_HOME: path.join(root, 'codex'), OPENAI_API_KEY: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('CLI previews without writing, preserves SKILL.md, backs up metadata, and can be run twice', t => {
  const { root, scope, skill, target } = fixture(t);
  const backupRoot = path.join(root, 'codex', 'skill-menu-zh-cn-backups');
  assert.match(run(root, ['--root', scope, '--dry-run', '--online']), /待修改 1/);
  assert.equal(fs.readFileSync(target, 'utf8'), yaml);
  assert.equal(fs.existsSync(backupRoot), false);

  assert.match(run(root, ['--root', scope]), /已修改 1/);
  assert.equal(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), markdown);
  const backup = path.join(backupRoot, fs.readdirSync(backupRoot)[0]);
  const index = JSON.parse(fs.readFileSync(path.join(backup, 'files.jsonl'), 'utf8'));
  assert.equal(index.target, fs.realpathSync(target));
  assert.equal(fs.readFileSync(path.join(backup, index.original), 'utf8'), yaml);
  assert.match(fs.readFileSync(target, 'utf8'), /display_name: Skill Creator/);
  assert.match(run(root, ['--root', scope]), /已修改 0，已有中文 1/);
  assert.equal(fs.readdirSync(backupRoot).length, 1);
});

test('creates only menu metadata when none exists and leaves a record for removal', t => {
  const { root, skill, target } = fixture(t);
  fs.unlinkSync(target);
  const change = planChange(inspectSkill(skill), '创建或更新 Skill');
  const backup = applyChanges([change], path.join(root, 'backups'), () => {}, (_, error) => { throw error; });
  assert.equal(fs.readFileSync(target, 'utf8'), 'interface:\n  short_description: "创建或更新 Skill"\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'files.jsonl'), 'utf8')).original, null);
});

test('prefers SKILL.json and ignores files that changed after scanning', t => {
  const { root, skill, target } = fixture(t);
  const json = path.join(skill, 'SKILL.json');
  fs.writeFileSync(json, '{"interface":{"display_name":"Skill Creator","short_description":"Old"}}');
  const change = planChange(inspectSkill(skill), '创建或更新 Skill');
  assert.equal(change.file, json);
  fs.writeFileSync(json, '{"interface":{"display_name":"Renamed elsewhere","short_description":"Old"}}');
  const problems = [];
  applyChanges([change], path.join(root, 'backup'), () => assert.fail('Unexpected write'), (_, error) => problems.push(error));
  assert.equal(problems.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(json, 'utf8')).interface.display_name, 'Renamed elsewhere');
  assert.equal(fs.readFileSync(target, 'utf8'), yaml);
});

test('scans cached plugin skills only with --plugins', t => {
  const { root, scope, skill } = fixture(t);
  const cache = path.join(root, 'codex', 'plugins', 'cache', 'example-market', 'example-plugin', '1.0.0');
  fs.mkdirSync(path.join(cache, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(cache, '.codex-plugin', 'plugin.json'), '{"skills":"./skills/"}');
  fs.cpSync(skill, path.join(cache, 'skills', 'copy'), { recursive: true });
  assert.match(run(root, ['--root', scope, '--dry-run']), /待修改 1/);
  assert.match(run(root, ['--root', scope, '--dry-run', '--plugins']), /待修改 2/);
});

test('deduplicates junctions and leaves targets outside the requested roots alone', t => {
  const { root, scope, skill } = fixture(t);
  const external = path.join(root, 'external');
  fs.cpSync(skill, external, { recursive: true });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(skill, path.join(scope, 'alias'), linkType);
  fs.symlinkSync(external, path.join(scope, 'outside'), linkType);
  const problems = [];
  assert.deepEqual(findSkills([scope], (file) => problems.push(file)), [fs.realpathSync(skill)]);
  assert.deepEqual(problems, [path.join(fs.realpathSync(scope), 'outside')]);
});

test('online translation sends only descriptions and matches results by ID', async () => {
  const result = await translateBatch(['Make images', 'Review code'], {
    apiKey: 'mock-key', model: 'mock-model', request: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.deepEqual(JSON.parse(body.input), [
        { id: 0, description: 'Make images' }, { id: 1, description: 'Review code' },
      ]);
      const text = JSON.stringify({ translations: [
        { id: 1, description: '审查代码' }, { id: 0, description: '生成图片' },
      ] });
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
    },
  });
  assert.deepEqual(result, ['生成图片', '审查代码']);
});

test('rejects refusals and duplicate translation IDs', async () => {
  const payloads = [
    { type: 'refusal', refusal: 'Not translated' },
    { type: 'output_text', text: '{"translations":[{"id":0,"description":"生成图片"},{"id":0,"description":"审查代码"}]}' },
  ];
  for (const content of payloads) {
    await assert.rejects(translateBatch(['Make images', 'Review code'], {
      apiKey: 'mock-key', model: 'mock-model',
      request: async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [content] }] }),
    }), /翻译/);
  }
});
