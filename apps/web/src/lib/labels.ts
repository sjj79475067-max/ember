/** 前后端共用的中文标签（不能 import 数据库，供客户端组件使用） */
export const KIND_LABEL: Record<string, string> = {
  feature: "功能", task: "一般", compliance: "资质合规", account: "账号开通", purchase: "采购",
  contract: "合同", finance: "财务", release: "发布", risk: "风险", doc: "文档",
};
export const ITEM_KINDS = Object.keys(KIND_LABEL);
export const KIND_TONE: Record<string, string> = {
  feature: "brand", compliance: "danger", account: "warn", purchase: "default", contract: "warn",
  finance: "ok", release: "brand", risk: "danger", doc: "default", task: "default",
};
export const HEALTH_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "danger" }> = {
  on_track: { label: "正常", tone: "ok" }, at_risk: { label: "有风险", tone: "warn" }, off_track: { label: "已偏离", tone: "danger" },
};
export const GATE_LABEL: Record<string, string> = { pending: "待评审", go: "已放行", hold: "暂缓/返工", kill: "已终止" };
export const MS_STATUS_LABEL: Record<string, string> = { planned: "未开始", active: "进行中", done: "已完成", cancelled: "已取消" };
export const REQ_STATUS_LABEL: Record<string, string> = { proposed: "提出", accepted: "确认要做", in_progress: "进行中", done: "已完成", dropped: "已放弃" };
