import { listProjects, createProject } from "@/lib/services/projects";
import { addItems } from "@/lib/services/items";
import { createMeeting } from "@/lib/services/meetings";
import { upsertPolicy } from "@/lib/services/policies";

export const dynamic = "force-dynamic";

export async function POST() {
  if (listProjects({}).length) return Response.json({ ok: false, error: "已有项目，不覆盖" });
  const actor = { type: "system" as const, name: "seed" };
  const day = Math.floor(Date.now() / 1000);
  const it = createProject({ key: "IT", name: "客户门户 V2 交付", kind: "client", summaryMd: "10 月底交付客户门户改版，含登录改造与数据看板。", dueAt: day + 20 * 86400, githubRepo: "myorg/portal" }, actor);
  const admin = createProject({ key: "ADMIN", name: "公司事务", kind: "admin", summaryMd: "工商年报、税务申报、合同归档等事务性工作。" }, actor);
  createProject({ key: "LEGAL", name: "法律事务", kind: "admin", summaryMd: "合同审查、知识产权、纠纷跟踪。" }, actor);
  addItems(it.id, [
    { title: "完成登录模块改造", doneDefinition: "手机号+验证码登录上线，e2e 覆盖", dueAt: day + 5 * 86400, priority: "P0", sourceType: "meeting" },
    { title: "数据看板接入新指标", doneDefinition: "GMV/留存/转化三个指标可在看板切换", dueAt: day + 9 * 86400, priority: "P1", sourceType: "meeting" },
    { title: "交付前全量回归测试", doneDefinition: "回归用例全绿，报告存档", dueAt: day + 16 * 86400, priority: "P1", sourceType: "meeting" },
    { title: "整理部署手册", doneDefinition: "DEPLOY.md 含一键部署与回滚", priority: "P2", sourceType: "meeting" },
  ], actor);
  addItems(admin.id, [
    { title: "办理工商年报", doneDefinition: "年报提交成功并留存回执", dueAt: day + 12 * 86400, priority: "P0" },
    { title: "Q4 增值税申报材料整理", doneDefinition: "票据齐备并交给会计", priority: "P1" },
  ], actor);
  await createMeeting({
    projectId: it.id, title: "客户门户 V2 需求评审", source: "feishu",
    minutesMd: "参会：客户方张总、我方李工。确认：1）登录改为手机号+验证码，10 月 25 日前完成；2）看板需要 GMV、留存、转化三个核心指标；3）交付前要做全量回归测试并出报告；4）部署手册要包含回滚步骤。",
    summaryMd: "确认登录改造、看板指标、回归测试与部署手册四项工作，交付期 10 月底。",
    items: [
      { title: "登录模块改为手机号+验证码", doneDefinition: "上线并通过 e2e", dueAt: day + 5 * 86400, priority: "P0" },
      { title: "看板增加 GMV/留存/转化指标", doneDefinition: "三个指标可切换查看", priority: "P1" },
    ],
  }, actor);
  upsertPolicy({ title: "AI 操作基本条例", bodyMd: "1. 任何清单任务完成必须提供 evidence（链接/路径/命令）。\n2. 会议记录一律用 meeting_import 归档，不要只写在聊天里。\n3. 资料位置变化必须在 24 小时内更新 file_register。\n4. 涉及财务付款、对外发送的事项必须由用户确认后才能标记 done。", required: true }, actor);
  return Response.json({ ok: true, projectIds: [it.id, admin.id] });
}
