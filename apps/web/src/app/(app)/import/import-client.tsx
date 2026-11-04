"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ClipboardPaste, FileText, ImagePlus, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

type P = { id: string; key: string; name: string };
type Preview = { title?: string; summary?: string; items?: Array<{ title: string; detailMd?: string; doneDefinition?: string; priority?: string }> };

const SOURCES = ["粘贴", "飞书", "腾讯会议", "录音转写", "历史对话", "文档"];

export function ImportClient({ projects, initialProject }: { projects: P[]; initialProject?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("粘贴");
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ meetingId?: string; createdCount?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  async function readFile(f: File) {
    if (f.type.startsWith("image/")) {
      toast.info("图片已添加。图片无法 OCR 时，可同时粘贴会议文字，二者会一起归档。");
      setText((t) => t + `\n\n[附件图片：${f.name}]`);
      return;
    }
    if (/\.(txt|md|markdown|csv|json)$/i.test(f.name) || f.type.startsWith("text/")) {
      setText(await f.text());
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
      return;
    }
    if (/\.docx$/i.test(f.name)) {
      toast.info("正在解析 Word 文档…");
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/ui/extract-text", { method: "POST", body: fd }).then((x) => x.json()).catch(() => null);
      if (r?.text) { setText(r.text); if (!title) setTitle(f.name.replace(/\.docx$/i, "")); }
      else toast.error(r?.error ?? "无法解析该文档，请粘贴文本");
      return;
    }
    if (/\.pdf$/i.test(f.name)) {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/ui/extract-text", { method: "POST", body: fd }).then((x) => x.json()).catch(() => null);
      if (r?.text) { setText(r.text); if (!title) setTitle(f.name.replace(/\.pdf$/i, "")); }
      else toast.error("PDF 未提取到文本（可能是扫描件），请粘贴文字");
      return;
    }
    toast.error("暂不支持该格式，请粘贴文本或上传 md/txt/docx/pdf");
  }

  async function doPreview() {
    if (!text.trim()) return toast.error("请先粘贴或上传会议记录");
    setBusy(true);
    try {
      const res = await fetch("/api/ui/import/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, title }) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "预览失败");
      setPreview(data.data);
      if (!data.data.ai) toast.info("未配置 AI，已按行拆分；可在设置里配置模型以获得更好的整理。");
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  async function commit() {
    setBusy(true);
    try {
      const res = await fetch("/api/ui/import/commit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId, title: preview?.title || title || "会议记录", source, text,
          summary: preview?.summary, items: preview?.items,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "保存失败");
      setResult({ meetingId: data.meetingId, createdCount: data.createdCount });
      toast.success(`已归档，生成 ${data.createdCount} 条任务`);
      router.refresh();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  if (result) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center p-8 pt-24 text-center">
        <div className="mb-4 grid size-14 place-items-center rounded-full bg-[var(--color-ok)]/15 text-[var(--color-ok)]"><Check className="size-7" /></div>
        <h1 className="text-xl font-semibold">已归档</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">会议档案已建立，提取出 {result.createdCount} 条待办事务。Agent 下次连接时会看到这些任务与提醒。</p>
        <div className="mt-5 flex gap-2">
          {result.meetingId && <Button onClick={() => router.push(`/meetings/${result.meetingId}`)}>查看会议档案</Button>}
          <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setText(""); setTitle(""); }}>继续导入</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">导入会议记录 / 资料</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">飞书、腾讯会议、录音转写、与 agent 的历史对话都可以。系统会整理成统一档案并抽取待办事务。</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">归入项目</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">来源</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 text-sm">
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1"><span className="text-xs text-[var(--color-muted)]">标题（可选，留空自动生成）</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：客户门户 V2 需求评审" />
        </label>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs text-[var(--color-muted)]">内容</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload /> 文档</Button>
            <Button size="sm" variant="outline" onClick={() => imgRef.current?.click()}><ImagePlus /> 截图</Button>
            <Button size="sm" variant="outline" onClick={async () => { const t = await navigator.clipboard.readText().catch(() => ""); if (t) setText(t); else toast.error("无法读取剪贴板"); }}><ClipboardPaste /> 粘贴</Button>
          </div>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4 text-[13px] leading-6 outline-none placeholder:text-[var(--color-muted)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
          placeholder={"把会议记录整段粘贴到这里…\n\n也可以先把飞书妙记 / 腾讯会议转写导出成 txt/md/docx/pdf，再上传。"} />
        <input ref={fileRef} type="file" accept=".md,.txt,.markdown,.docx,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { [...(e.target.files ?? [])].forEach(readFile); }} />
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">支持 md / txt / docx / pdf 自动提取文本；截图作为附件参考。文件较大时建议在电脑端用 agent 通过 MCP 的 meeting_import 直接传入。</p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={doPreview} disabled={busy}>{busy ? "整理中…" : <><Sparkles /> 智能整理预览</>}</Button>
      </div>

      {preview && (
        <Card className="mt-5">
          <CardContent className="p-5">
            <div className="flex items-center gap-2"><FileText className="size-4 text-[var(--color-brand)]" /><p className="font-medium">{preview.title}</p></div>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-muted)]">{preview.summary}</p>
            <h3 className="mt-4 mb-2 text-xs font-semibold text-[var(--color-muted)]">将生成 {preview.items?.length ?? 0} 条任务</h3>
            <ul className="flex flex-col gap-1.5">
              {(preview.items ?? []).map((it, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-line)] p-2.5 text-[13px]">
                  <span className="mt-0.5 text-[var(--color-muted)]">{i + 1}.</span>
                  <div><p>{it.title}</p>{it.doneDefinition && <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">完成标准：{it.doneDefinition}</p>}</div>
                  {it.priority && <Badge className="ml-auto shrink-0">{it.priority}</Badge>}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>取消</Button>
              <Button onClick={commit} disabled={busy}>{busy ? "保存中…" : "确认归档并生成任务"}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
