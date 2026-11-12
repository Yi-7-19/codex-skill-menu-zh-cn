import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readMetadata, readSkill, setMenuDescription } from './metadata.mjs';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function statIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function read(file) {
  const stat = statIfPresent(file);
  if (!stat) return null;
  if (!stat.isFile()) throw new Error('预期为普通文件，已跳过链接或目录。');
  if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MiB。');
  return utf8.decode(fs.readFileSync(file));
}

function inside(file, root) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function directories(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory());
}

export function pluginRoots(codexHome, report) {
  const cache = path.join(codexHome, 'plugins', 'cache');
  if (!statIfPresent(cache)) return [];
  const roots = [];
  for (const marketplace of directories(cache)) {
    const marketplaceDir = path.join(cache, marketplace.name);
    for (const plugin of directories(marketplaceDir)) {
      const pluginDir = path.join(marketplaceDir, plugin.name);
      for (const version of directories(pluginDir)) {
        const versionDir = path.join(pluginDir, version.name);
        try {
          const manifest = read(path.join(versionDir, '.codex-plugin', 'plugin.json'));
          if (manifest === null) continue;
          const skills = JSON.parse(manifest).skills;
          if (typeof skills !== 'string' || !skills.trim()) continue;
          const root = path.resolve(versionDir, skills);
          if (!inside(root, versionDir) || !statIfPresent(root)?.isDirectory() ||
              !inside(fs.realpathSync(root), fs.realpathSync(versionDir))) {
            throw new Error('插件 Skill 目录无效或链接到插件之外。');
          }
          roots.push(root);
        } catch (error) {
          report(versionDir, error);
        }
      }
    }
  }
  return roots;
}

export function findSkills(roots, report) {
  const allowed = [];
  const seen = new Set();
  const skills = [];
  for (const root of roots) {
    try {
      const resolved = fs.realpathSync(root);
      if (!fs.statSync(resolved).isDirectory()) throw new Error('Skill 根路径须为目录。');
      allowed.push(resolved);
    } catch (error) {
      if (error.code !== 'ENOENT') report(root, error);
    }
  }

  function visit(directory) {
    try {
      const resolved = fs.realpathSync(directory);
      if (!allowed.some(root => inside(resolved, root))) {
        report(directory, new Error('链接指向扫描范围之外。可用 --root 指定该 Skill。'));
        return;
      }
      if (seen.has(resolved)) return;
      seen.add(resolved);
      if (statIfPresent(path.join(resolved, 'SKILL.md'))) {
        skills.push(resolved);
        return;
      }
      for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const child = path.join(resolved, entry.name);
        if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(child, { throwIfNoEntry: false })?.isDirectory())) {
          visit(child);
        }
      }
    } catch (error) {
      report(directory, error);
    }
  }
  for (const root of allowed) visit(root);
  return skills;
}

export function inspectSkill(directory) {
  const manifest = path.join(directory, 'SKILL.md');
  const markdown = read(manifest);
  if (markdown === null) throw new Error('SKILL.md 已移除。');
  const { name, description } = readSkill(markdown);
  const json = path.join(directory, 'SKILL.json');
  const fileType = statIfPresent(json) ? 'json' : 'yaml';
  const agents = path.join(directory, 'agents');
  const yaml = path.join(agents, 'openai.yaml');
  if (fileType === 'yaml' && statIfPresent(agents) && !statIfPresent(agents).isDirectory()) {
    throw new Error('agents 须为本地目录。');
  }
  const file = fileType === 'json' ? json : yaml;
  const before = read(file);
  const { description: short } = readMetadata(before ?? '', fileType);
  return { directory, manifest, markdown, name, source: short || description, file, before, fileType };
}

export function planChange(skill, translation) {
  return {
    ...skill,
    after: setMenuDescription(skill.before ?? '', skill.fileType, translation),
    translation,
  };
}

function writeChange(change, backup) {
  if (fs.realpathSync(change.directory) !== change.directory) throw new Error('Skill 目录已变化。');
  const fresh = inspectSkill(change.directory);
  if (fresh.markdown !== change.markdown || fresh.file !== change.file || fresh.before !== change.before) {
    throw new Error('扫描后文件已变化。请重新运行。');
  }
  const original = change.before === null ? null : randomUUID() + '-' + path.basename(change.file);
  if (original) fs.writeFileSync(path.join(backup, original), change.before, { flag: 'wx', mode: 0o600 });
  const record = {
    skill: change.name,
    target: change.file,
    original,
    updatedSha256: createHash('sha256').update(change.after).digest('hex'),
  };
  fs.appendFileSync(path.join(backup, 'files.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });

  fs.mkdirSync(path.dirname(change.file), { recursive: true });
  const temporary = change.file + '.' + randomUUID() + '.tmp';
  const permissions = statIfPresent(change.file)?.mode & 0o777;
  fs.writeFileSync(temporary, change.after, { flag: 'wx', mode: permissions || 0o644 });
  try {
    const current = inspectSkill(change.directory);
    if (current.file !== change.file || current.before !== change.before || current.markdown !== change.markdown) {
      throw new Error('写入前文件已变化。请重新运行。');
    }
    if (change.before === null) {
      fs.linkSync(temporary, change.file);
    } else {
      fs.renameSync(temporary, change.file);
    }
  } finally {
    if (statIfPresent(temporary)) fs.unlinkSync(temporary);
  }
}

export function applyChanges(changes, backupRoot, onApplied, onError) {
  if (!changes.length) return null;
  fs.mkdirSync(backupRoot, { recursive: true });
  const backup = fs.mkdtempSync(path.join(backupRoot, new Date().toISOString().slice(0, 10) + '-'));
  for (const change of changes) {
    try {
      writeChange(change, backup);
      onApplied(change);
    } catch (error) {
      onError(change.file, error);
    }
  }
  return backup;
}
