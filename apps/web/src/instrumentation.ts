export async function register() {
  // 只在 Node 运行时启动渠道（写成 if 块，让 edge 编译时整段剔除）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
