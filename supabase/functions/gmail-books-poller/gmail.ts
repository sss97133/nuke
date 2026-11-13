import type { Email } from "./core.ts";
export interface Part {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}
export interface Message {
  id: string;
  threadId?: string;
  internalDate: string;
  payload: Part;
}
function decode(s: string): string {
  const encoded = s.replaceAll("-", "+").replaceAll("_", "/");
  return new TextDecoder().decode(
    Uint8Array.from(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      (c) => c.charCodeAt(0),
    ),
  );
}
export function parseMessage(m: Message): Email {
  const get = (name: string) =>
    m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const plain: string[] = [],
    html: string[] = [],
    attachments: NonNullable<Email["attachments"]> = [];
  const visit = (p: Part) => {
    if (p.filename) {
      attachments.push({
        filename: p.filename,
        attachmentId: p.body?.attachmentId,
        mimeType: p.mimeType,
      });
    } else if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(decode(p.body.data));
      else if (p.mimeType === "text/html") html.push(decode(p.body.data));
    }
    p.parts?.forEach(visit);
  };
  visit(m.payload);
  // Store text, never render email HTML; attachment bodies are deliberately not fetched.
  const text = plain.length
    ? plain.join("\n")
    : html.join("\n").replace(/<[^>]*>/g, " ").replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&");
  return {
    id: m.id,
    threadId: m.threadId,
    messageId: get("message-id"),
    sender: get("from"),
    subject: get("subject"),
    receivedAt: new Date(Number(m.internalDate)).toISOString(),
    text,
    attachments,
  };
}
