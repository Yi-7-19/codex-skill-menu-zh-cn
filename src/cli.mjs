import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { applyChanges, findSkills, inspectSkill, planChange, pluginRoots } from './skills.mjs';
import { fingerprint, isChinese, translateBatch } from './translation.mjs';

const help = `Codex Skill 菜单中文化

  node src/cli.mjs [--dry-run] [--online] [--plugins] [--root <目录>] [--model <模型>]

  --dry-run      预览扫描结果，不写入文件或请求翻译 API
  --online       使用 OPENAI_API_KEY 翻译词库未收录的说明
  --plugins      同时扫描 Codex 的本地插件缓存
  --root <目录>  使用指定 Skill 或 Skill 根目录代替默认目录，可重复
  --model <模型> 在线翻译模型，默认为 gpt-5-mini
  --help        显示帮助`;

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' }, online: { type: 'boolean' }, plugins: { type: 'boolean' },
      root: { type: 'string', multiple: true }, model: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }

  const catalog = JSON.parse(fs.readFileSync(new URL('../catalog.zh-CN.json', import.meta.url), 'utf8'));
  const bySource = new Map(catalog.map(item => [item.skill + ':' + item.sourceSha256, item.description]));
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const roots = values.root?.map(root => path.resolve(root)) ?? [
    path.join(os.homedir(), '.agents', 'skills'), path.join(codexHome, 'skills'), path.join(codexHome, 'skills', '.system'),
  ];
  let issues = 0;
  function report(file, error) {
    issues++;
    console.error('[跳过]', file, error.message);
  }
  if (values.plugins) roots.push(...pluginRoots(codexHome, report));

  const changes = [];
  const pending = [];
  let chinese = 0;
  function prepare(skill, translation) {
    try {
      changes.push(planChange(skill, translation));
    } catch (error) {
      report(skill.file, error);
    }
  }
  for (const directory of findSkills(roots, report)) {
    try {
      const skill = inspectSkill(directory);
      if (isChinese(skill.source)) {
        chinese++;
        continue;
      }
      const match = bySource.get(skill.name + ':' + fingerprint(skill.source));
      if (match) prepare(skill, match);
      else pending.push(skill);
    } catch (error) {
      report(directory, error);
    }
  }

  const translations = new Map();
  if (values.online && !values['dry-run'] && pending.length) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      report('在线翻译', new Error('请先设置 OPENAI_API_KEY。'));
    } else {
      const sources = [...new Set(pending.map(skill => skill.source))];
      for (let offset = 0; offset < sources.length; offset += 12) {
        const batch = sources.slice(offset, offset + 12);
        try {
          const labels = await translateBatch(batch, { apiKey, model: values.model || 'gpt-5-mini' });
          batch.forEach((source, index) => translations.set(source, labels[index]));
        } catch (error) {
          report('在线翻译', error);
          break;
        }
      }
    }
  }

  let untranslated = 0;
  for (const skill of pending) {
    const translation = translations.get(skill.source);
    if (translation) prepare(skill, translation);
    else {
      untranslated++;
      console.log('[待翻译]', skill.name, skill.file);
    }
  }

  let written = 0;
  if (values['dry-run']) {
    for (const change of changes) console.log('[预览]', change.name, '→', change.translation);
  } else {
    const backup = applyChanges(changes, path.join(codexHome, 'skill-menu-zh-cn-backups'), change => {
      written++;
      console.log('[已修改]', change.name, '→', change.translation);
    }, report);
    if (backup) console.log('备份目录', backup);
  }
  const total = values['dry-run'] ? '待修改 ' + changes.length : '已修改 ' + written;
  console.log([total, '已有中文 ' + chinese, '待翻译 ' + untranslated, '跳过 ' + issues].join('，'));
  if (issues) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
