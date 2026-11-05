/**
 * 项目模板：国内常见场景的阶段与配套事项。
 * 周期/规则来源：阿里云 ICP 备案流程、微信小程序备案文档、中国版权保护中心办理时限、网信办 App 必要个人信息范围、
 * 阿里云短信签名审核说明、微信支付商户申请说明（见 docs/SPEC-BATCH1.md 与调研记录）。具体以各平台最新公告为准。
 */
export type TplItem = {
  key: string; title: string; kind: string; phase: string; mustMeet?: boolean; leadTimeDays?: number;
  doneDefinition?: string; detail?: string; deps?: string[]; priority?: "P0" | "P1" | "P2" | "P3";
};
export type TplPhase = { name: string; goal: string; kind?: "phase" | "release" };
export type Template = { key: string; name: string; description: string; phases: TplPhase[]; items: TplItem[] };

const DEV_PHASES: TplPhase[] = [
  { name: "设计", goal: "需求确认、原型与技术方案定稿" },
  { name: "开发", goal: "核心功能完成并可内部演示" },
  { name: "测试", goal: "功能与回归测试通过，可灰度" },
  { name: "上线", goal: "资质齐全、正式发布第一版", kind: "release" },
];

const BASE_DEV: TplItem[] = [
  { key: "prd", title: "需求清单与范围确认", kind: "doc", phase: "设计", mustMeet: true, doneDefinition: "需求逐条录入「需求」页并标为确认，范围外的写明不做" },
  { key: "proto", title: "原型/交互稿定稿", kind: "doc", phase: "设计", mustMeet: true, doneDefinition: "原型链接登记到资料，关键页面走查通过" },
  { key: "arch", title: "技术方案与部署架构", kind: "doc", phase: "设计", mustMeet: true, doneDefinition: "方案文档登记位置，含数据存储与备份策略" },
  { key: "core", title: "核心功能开发完成", kind: "feature", phase: "开发", mustMeet: true, doneDefinition: "需求页中本期需求全部有对应事项且已完成" },
  { key: "demo", title: "内部演示", kind: "task", phase: "开发", doneDefinition: "演示记录归档到会议" },
  { key: "test", title: "功能与回归测试", kind: "task", phase: "测试", mustMeet: true, doneDefinition: "测试用例与结果登记，P0/P1 缺陷清零" },
  { key: "backup", title: "数据备份与恢复演练", kind: "task", phase: "测试", mustMeet: true, doneDefinition: "演练一次恢复并记录耗时" },
  { key: "monitor", title: "监控告警与回滚预案", kind: "release", phase: "测试", mustMeet: true, doneDefinition: "告警能推到手机，回滚步骤写进资料" },
];

const NET_INFRA: TplItem[] = [
  { key: "domain", title: "购买域名并完成实名认证", kind: "account", phase: "设计", mustMeet: true, leadTimeDays: 3, doneDefinition: "域名实名审核通过，记录注册商与到期日", detail: "备案要求域名已实名且在有效期内；建议一次续费到备案周期之后" },
  { key: "server", title: "开通内地云服务器", kind: "account", phase: "开发", mustMeet: true, leadTimeDays: 1, doneDefinition: "实例开通，记录账号归属与到期日", detail: "ICP 备案需要在内地云厂商有可备案的实例（通常要求包年包月、剩余时长 ≥ 3 个月）", deps: [] },
  { key: "icp", title: "ICP 备案", kind: "compliance", phase: "上线", mustMeet: true, leadTimeDays: 20, doneDefinition: "拿到备案号，登记到资料", detail: "云厂商初审 1–2 工作日 + 管局 1–20 工作日；期间网站不能解析到内地服务器。主体、域名、负责人信息要一致", deps: ["domain", "server"], priority: "P0" },
  { key: "gongan", title: "公安联网备案", kind: "compliance", phase: "上线", mustMeet: true, leadTimeDays: 10, doneDefinition: "拿到公安备案号并在网站底部展示", detail: "网站开通后 30 日内在全国互联网安全管理服务平台办理，前置条件是 ICP 备案", deps: ["icp"] },
  { key: "https", title: "HTTPS 证书与自动续期", kind: "account", phase: "上线", mustMeet: true, leadTimeDays: 1, doneDefinition: "证书生效并配置自动续期，登记到期日", deps: ["icp"] },
  { key: "privacy", title: "隐私政策与个人信息收集清单", kind: "compliance", phase: "测试", mustMeet: true, leadTimeDays: 5, doneDefinition: "隐私政策上线可访问，首次启动弹窗同意，只收集必要信息", detail: "参照《常见类型移动互联网应用程序必要个人信息范围规定》，不得因拒绝非必要信息而拒绝基本功能" },
  { key: "tos", title: "用户协议", kind: "compliance", phase: "测试", mustMeet: true, leadTimeDays: 3, doneDefinition: "用户协议上线可访问" },
  { key: "sms", title: "短信签名与模板报备", kind: "account", phase: "上线", leadTimeDays: 5, doneDefinition: "签名与验证码模板审核通过，运营商报备完成", detail: "签名需绑定已备案的网站/App 或企业名称；平台审核约 2 小时，运营商实名报备另需 1–3 工作日，未报备可能被拦截", deps: ["icp"] },
  { key: "pay", title: "支付商户号开通（微信/支付宝）", kind: "account", phase: "上线", leadTimeDays: 7, doneDefinition: "商户号可收款，费率协议与对账方式确认", detail: "需要营业执照、法人身份证、对公账户；审核约 1–2 工作日，签约与对接再留几天" },
];

export const TEMPLATES: Template[] = [
  {
    key: "app", name: "App（国内上架）", description: "移动应用：设计 → 开发 → 测试 → 上线，内置备案、软著、隐私合规与各大商店上架前置项",
    phases: DEV_PHASES,
    items: [
      ...BASE_DEV, ...NET_INFRA,
      { key: "app_filing", title: "App 备案", kind: "compliance", phase: "上线", mustMeet: true, leadTimeDays: 20, doneDefinition: "拿到 App 备案号（应用商店上架必填）", detail: "通过接入的云厂商或分发平台提交；平台初审 + 12381 短信核验 + 管局 1–20 工作日", deps: ["server"], priority: "P0" },
      { key: "softcopy", title: "软件著作权登记", kind: "compliance", phase: "开发", mustMeet: true, leadTimeDays: 60, doneDefinition: "拿到软著登记证书", detail: "法定受理后 60 日内审查完成，实际常见 1–2 个月；多数安卓商店上架要求，尽早提交", priority: "P0" },
      { key: "store_accounts", title: "应用商店开发者账号（华为/小米/OPPO/vivo/应用宝/苹果）", kind: "account", phase: "开发", mustMeet: true, leadTimeDays: 5, doneDefinition: "各商店企业开发者认证通过，账号归属登记", detail: "均需企业实名认证，一般 1–5 工作日；苹果企业账号需要邓白氏编码，时间更长" },
      { key: "store_submit", title: "提交各商店审核", kind: "release", phase: "上线", mustMeet: true, leadTimeDays: 5, doneDefinition: "主要商店审核通过并上架", deps: ["app_filing", "softcopy", "privacy", "tos", "store_accounts"] },
      { key: "gray", title: "灰度发布与观察", kind: "release", phase: "上线", doneDefinition: "灰度期间崩溃率与关键指标在阈值内", deps: ["store_submit", "monitor"] },
    ],
  },
  {
    key: "miniprogram", name: "微信小程序", description: "小程序：账号、备案、类目资质、隐私指引、服务器域名配置与提审",
    phases: DEV_PHASES,
    items: [
      ...BASE_DEV,
      { key: "mp_account", title: "注册小程序账号并完成企业认证", kind: "account", phase: "设计", mustMeet: true, leadTimeDays: 3, doneDefinition: "认证通过，AppID 与管理员登记" },
      { key: "mp_filing", title: "小程序备案", kind: "compliance", phase: "开发", mustMeet: true, leadTimeDays: 20, doneDefinition: "备案通过（未备案无法发布）", detail: "填写信息 + 人脸核身 → 平台初审 1–2 工作日 → 12381 短信 24 小时内核验 → 管局 1–20 工作日", deps: ["mp_account"], priority: "P0" },
      { key: "mp_category", title: "服务类目与资质", kind: "compliance", phase: "开发", mustMeet: true, leadTimeDays: 5, doneDefinition: "类目审核通过，所需资质已上传", deps: ["mp_account"] },
      { key: "mp_privacy", title: "用户隐私保护指引", kind: "compliance", phase: "测试", mustMeet: true, leadTimeDays: 2, doneDefinition: "后台隐私指引填写并通过", deps: ["mp_account"] },
      { key: "domain", title: "购买域名并完成实名认证", kind: "account", phase: "设计", mustMeet: true, leadTimeDays: 3, doneDefinition: "域名实名审核通过" },
      { key: "server", title: "开通内地云服务器", kind: "account", phase: "开发", mustMeet: true, leadTimeDays: 1, doneDefinition: "实例开通，记录到期日" },
      { key: "icp", title: "ICP 备案（接口域名）", kind: "compliance", phase: "开发", mustMeet: true, leadTimeDays: 20, doneDefinition: "接口域名备案号登记", detail: "小程序请求的服务器域名必须是已备案的 HTTPS 域名", deps: ["domain", "server"], priority: "P0" },
      { key: "mp_domains", title: "配置服务器域名（request/upload 合法域名）", kind: "task", phase: "测试", mustMeet: true, doneDefinition: "后台合法域名配置完成，真机请求通过", deps: ["icp"] },
      { key: "mp_submit", title: "提交审核并发布", kind: "release", phase: "上线", mustMeet: true, leadTimeDays: 3, doneDefinition: "审核通过并全量发布", deps: ["mp_filing", "mp_category", "mp_privacy", "mp_domains"] },
    ],
  },
  {
    key: "saas", name: "网站 / SaaS", description: "Web 产品：域名、服务器、备案、HTTPS、隐私协议、支付短信；可选经营许可证与等保",
    phases: DEV_PHASES,
    items: [
      ...BASE_DEV, ...NET_INFRA,
      { key: "launch", title: "正式上线发布", kind: "release", phase: "上线", mustMeet: true, doneDefinition: "生产环境可访问，首页展示 ICP 与公安备案号", deps: ["icp", "gongan", "https", "privacy", "tos"] },
      { key: "icp_license", title: "（按需）ICP 经营许可证", kind: "compliance", phase: "上线", leadTimeDays: 45, doneDefinition: "如提供有偿信息服务/付费会员，取得许可证；否则写明不需要后关闭", detail: "经营性网站才需要；ICP 备案完成后申请，约 1–2 个月", deps: ["icp"], priority: "P2" },
      { key: "dengbao", title: "（按需）等级保护定级与测评", kind: "compliance", phase: "上线", leadTimeDays: 60, doneDefinition: "需要时完成定级备案与测评；不需要则写明原因后关闭", detail: "有用户数据或支付的系统通常定二级；大客户、招投标常要求", priority: "P3" },
    ],
  },
  {
    key: "client", name: "客户交付", description: "外包/定制交付：签约 → 实施 → 验收 → 结项，含合同、确认单、验收单、开票与回款",
    phases: [
      { name: "签约", goal: "合同签署、范围与付款节点确认" },
      { name: "实施", goal: "按确认的需求交付" },
      { name: "验收", goal: "客户签字验收", kind: "release" },
      { name: "结项", goal: "开票、回款、资料归档" },
    ],
    items: [
      { key: "quote", title: "报价与方案", kind: "doc", phase: "签约", mustMeet: true, doneDefinition: "报价单与方案发出并留存" },
      { key: "contract", title: "签署合同", kind: "contract", phase: "签约", mustMeet: true, leadTimeDays: 7, doneDefinition: "双方盖章合同扫描件登记到资料，付款节点写进事项", priority: "P0", deps: ["quote"] },
      { key: "req_confirm", title: "需求确认单", kind: "contract", phase: "签约", mustMeet: true, doneDefinition: "客户书面确认需求范围（邮件/签字均可），需求逐条录入「需求」页", deps: ["contract"] },
      { key: "deposit", title: "收取首付款", kind: "finance", phase: "签约", doneDefinition: "到账记录登记", deps: ["contract"] },
      { key: "deliver", title: "按需求交付", kind: "feature", phase: "实施", mustMeet: true, doneDefinition: "需求页本期需求全部完成或经客户同意放弃", deps: ["req_confirm"] },
      { key: "change_log", title: "变更记录（范围外需求）", kind: "doc", phase: "实施", doneDefinition: "范围外需求均有客户确认的变更与报价，或写明拒绝" },
      { key: "acceptance", title: "客户验收签字", kind: "contract", phase: "验收", mustMeet: true, doneDefinition: "验收单签字扫描件登记", deps: ["deliver"], priority: "P0" },
      { key: "invoice", title: "开具发票", kind: "finance", phase: "结项", mustMeet: true, doneDefinition: "数电票开具并发送客户", deps: ["acceptance"] },
      { key: "payment", title: "收取尾款", kind: "finance", phase: "结项", mustMeet: true, doneDefinition: "尾款到账", deps: ["invoice"], priority: "P0" },
      { key: "archive", title: "交付物与源码归档", kind: "doc", phase: "结项", mustMeet: true, doneDefinition: "源码、文档、账号移交清单登记位置", deps: ["acceptance"] },
    ],
  },
  {
    key: "basic", name: "通用项目", description: "只建「计划 → 执行 → 收尾」三个阶段，不预置事项",
    phases: [{ name: "计划", goal: "明确目标与范围" }, { name: "执行", goal: "完成主要工作" }, { name: "收尾", goal: "验收、归档、复盘", kind: "release" }],
    items: [],
  },
];

export function getTemplate(key: string) {
  return TEMPLATES.find((t) => t.key === key) ?? null;
}