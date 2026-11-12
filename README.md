# Codex Skill 菜单中文化

批量把 Codex 对话框 `/` 菜单中的 Skill 说明改为简体中文。脚本只写入菜单元数据里的 `interface.short_description`，保留名称、显示名称、`SKILL.md` 和调用策略。

## Windows 双击运行

1. 安装带 npm 的 [Node.js 22 或更高版本](https://nodejs.org/)。
2. [下载项目 ZIP](https://github.com/Yi-7-19/codex-skill-menu-zh-cn/archive/refs/heads/main.zip) 并解压。
3. 双击 `localize.cmd`。首次运行会从 npm 下载锁定版本的 YAML 解析库，之后可离线使用词库。

默认扫描 `~/.agents/skills` 和 Codex 用户目录中的 `skills`，包括其中的内置 Skill。脚本保留已有中文说明，并列出词库未覆盖的条目。词库按 Skill 名称和原说明匹配，同名 Skill 的原说明变化后会重新进入待翻译列表。

## 翻译词库未收录的新 Skill

设置 `OPENAI_API_KEY` 环境变量后，双击 `localize-online.cmd`。也可以在终端执行 `.\localize.cmd --online`。在线模式会向 OpenAI API 发送待翻译的说明文本，可能产生 API 费用。需要指定模型时加上 `--model <模型>`，默认使用 `gpt-5-mini`。 [OpenAI API 的结构化输出文档](https://developers.openai.com/api/docs/guides/structured-outputs)

## 预览和指定范围

```powershell
.\localize.cmd --dry-run
.\localize.cmd --root 'D:\my-project\.agents\skills' --dry-run
.\localize.cmd --online --plugins
```

- `--dry-run` 只预览，既不写文件也不调用翻译 API。
- `--root` 用指定目录替换默认扫描范围，可多次传入。链接到范围外的 Skill 可通过该参数明确纳入。
- `--plugins` 额外扫描本地插件缓存。插件同步或更新可能覆盖缓存中的修改，应用仍可能显示来自远端的说明。

macOS 或 Linux 可以在项目目录执行 `npm ci --ignore-scripts`，再执行 `node src/cli.mjs`。参数和 Windows 相同。

## 文件与备份

脚本使用 `agents/openai.yaml`。如果 Skill 已有优先使用的 `SKILL.json`，脚本更新其中的同名字段。一般重新打开 `/` 菜单即可查看变化。若应用仍显示旧内容，可以重启 Codex。 [Codex Skill 的可选界面元数据](https://learn.chatgpt.com/docs/build-skills#optional-metadata)

每次写入前，脚本在 `$CODEX_HOME/skill-menu-zh-cn-backups/` 下备份原文件。未设置 `CODEX_HOME` 时使用 `~/.codex`。每个批次的 `files.jsonl` 记录目标路径、备份文件名和修改后的 SHA-256。恢复时先确认目标文件自运行后未被其他操作更新，再把对应备份复制回原路径。`original` 为 `null` 表示脚本新建了该文件，可按记录移除。

## 开发

```sh
npm ci --ignore-scripts
npm test
```

项目使用 [MIT 许可证](LICENSE)。
