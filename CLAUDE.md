# Ember 仓库

修改这个仓库前：
1. 读 `docs/MAINTAINER.md`，里面有红线、架构、测试和部署方法。
2. 读维护账本：能连 Ember MCP 就调 `maintainer_brief`，否则跑 `node scripts/maintainer-brief.mjs`。账本里的「决定」是已经定下来的做法，不要推翻重做；要改先问用户。
3. 用户提的新要求，先记成 EMBER 项目的需求再动手。改完把新决定记回 Ember，不要只留在对话里。

红线：不对正式实例（端口 3000、容器 ember-web-1）做测试；不碰用户的真实密码；部署前先备份。
