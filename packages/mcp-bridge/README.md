# ember-mcp

给只支持 **stdio** 的 MCP 客户端用的桥，转发到 Ember 的远程 Streamable HTTP 端点。

```bash
npx ember-mcp --url https://your-ember-host --token ember_xxx
```

配置示例（Claude Desktop / Cline 的 stdio 模式）：

```json
{
  "mcpServers": {
    "ember": { "command": "npx", "args": ["-y", "ember-mcp", "--url", "http://localhost:3000", "--token", "ember_xxx"] }
  }
}
```
