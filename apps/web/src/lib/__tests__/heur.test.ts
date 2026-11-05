import { it, expect } from "vitest";
import { looksLikeProgressNotCompletion as f } from "@/lib/services/items";
it("heuristic table", () => {
  const P = (t: string, e: string) => f(t, e).progress;
  const cases: Array<[string, string, boolean]> = [
    ["提交报价单", "已对接客户采购", true],
    ["提交报价单", "跟进中", true],
    ["提交报价单", "提交报价单", true],
    ["提交报价单", "已提交报价单至客户邮箱，客户确认收到", false],
    ["签合同", "签署版合同已回传，扫描件在 /docs/c.pdf", false],
    ["ICP 备案", "已对接云厂商", true],
    ["ICP 备案", "拿到备案号 京ICP备2026000001号，已登记", false],
    ["发送催款函", "已联系对方财务", true],
    ["准备投标材料", "完整标书已上传采购平台，回执号 8821", false],
    ["申请微信开放平台移动应用", "开放平台审核通过，AppID wx12ab 已登记到资料", false],
    ["接入微信登录 SDK", "iPhone/华为真机扫码登录成功，录屏在 ~/Desktop/login.mov", false],
    ["买显示器", "已下单，等到货", true],
    ["买显示器", "已到货签收，型号 U2724D 放在书房", false],
    ["开通服务器", "完成一半，还差安全组", true],
    ["写隐私政策", "初稿写好了", true],
    ["写隐私政策", "已发布 https://x.com/privacy", false],
    ["ICP 备案", "已提交审核，等管局", true],
    ["软著登记", "已申请，受理号 2026R11L000123", true],
    ["软著登记", "拿到登记证书，证书号 软著登字第123456号，扫描件已归档", false],
    ["客户回款", "尾款 3 万已到账", false],
    ["买显示器", "已下单，订单号 556677889", true],
  ];
  const bad = cases.filter(([t, e, want]) => P(t, e) !== want).map(([t, e, want]) => `${t} | ${e} | 期望${want ? "进度" : "完成"}`);
  expect(bad).toEqual([]);
});
