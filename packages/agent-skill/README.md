# ember-center Skill（Claude Code）

把本目录复制到 `~/.claude/skills/ember-center/`，然后在该 skill 的 frontmatter 或项目 `CLAUDE.md` 里设置：

```
EMBER_URL=http://localhost:3000
EMBER_TOKEN=ember_xxx   # 在 Ember 的「接入 Agent」页生成
```

新会话首次触发该 skill 时，agent 会先 `onboard` 再按工作流执行。

Codex 用户把 `SKILL.md` 正文追加到项目的 `AGENTS.md` 即可。
