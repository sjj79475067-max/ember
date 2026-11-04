import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ ok: false, error: "缺少文件" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const text = extractPdfText(buf);
      if (!text.trim()) return Response.json({ ok: false, error: "PDF 未提取到文本（可能是扫描件）" });
      return Response.json({ ok: true, text });
    }
    if (file.name.toLowerCase().endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: buf });
      return Response.json({ ok: true, text: r.value });
    }
    return Response.json({ ok: false, error: "不支持的格式" }, { status: 415 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** 轻量 PDF 文本提取：解压流 + 提取 Tj/TJ 字符串；覆盖常见文字型 PDF */
function extractPdfText(buf: Buffer): string {
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const raw = buf.toString("latin1");
  const pieces: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    let data: Buffer | null = null;
    try { data = zlib.inflateSync(chunk); } catch {
      try { data = zlib.inflateRawSync(chunk); } catch { data = null; }
    }
    if (!data) continue;
    const txt = data.toString("latin1");
    if (!/(Tj|TJ)/.test(txt)) continue;
    pieces.push(decodeContentStream(txt));
  }
  return pieces.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeContentStream(s: string): string {
  const out: string[] = [];
  const toks = s.match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?|T[Jj*]|Td|TD|'|"/g) ?? [];
  let line = "";
  for (const t of toks) {
    if (t.startsWith("(")) {
      line += unescapePdf(t.slice(1, -1));
    } else if (t.startsWith("<") && t.endsWith(">")) {
      const hex = t.slice(1, -1).replace(/\s+/g, "");
      let str = "";
      if (/^(FEFF|feff)/.test(hex)) {
        for (let i = 4; i < hex.length; i += 4) str += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      } else {
        for (let i = 0; i + 1 < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      line += str;
    } else if (t === "Td" || t === "TD" || t === "T*" || t === "'" || t === '"') {
      if (line.trim()) out.push(line);
      line = "";
    }
  }
  if (line.trim()) out.push(line);
  return out.join("\n");
}

function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c: string) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[c] ?? c;
  });
}
