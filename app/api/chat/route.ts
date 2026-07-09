import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadARData, answerQuestion, buildContext } from "@/lib/arQuery";

/*
  The AR chatbot's server route. The scripted engine in lib/arQuery.ts is the
  primary answerer — free, instant, works offline, and recognises customers,
  invoice/receipt numbers, time periods and ~25 intent families over the live
  Supabase data.

  Optional upgrade: if ANTHROPIC_API_KEY is ever set (server-side, in the
  git-ignored .env.development.local), questions go to Claude Sonnet 5 with the
  same live data as context, and the scripted engine becomes the fallback.
*/

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are the AR assistant inside Verve Advisory's AR Manager app, answering the finance team's questions about their live accounts receivable data.

Rules:
- Answer ONLY from the data snapshot provided below. If the data can't answer the question, say so briefly — never invent figures.
- Be concise and direct: lead with the number or name asked for, then at most 2-3 supporting sentences. Use Indian rupee formatting as given in the data.
- When asked for advice (who to chase, credit risk), base it on overdue amounts, days late, and credit limits from the data.
- Plain text only — no markdown tables or headers. Short lists are fine.`;

export async function POST(req: Request) {
  let body: { question?: string; history?: { role: string; text: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const question = (body.question ?? "").trim().slice(0, 500);
  if (!question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });

  const data = await loadARData();
  if (!data) {
    return NextResponse.json({ answer: "I can't reach the database right now — check the Supabase connection.", mode: "scripted" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const anthropic = new Anthropic({ apiKey });
      const history = (body.history ?? [])
        .slice(-6)
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 1000) }));

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "text", text: `AR DATA SNAPSHOT:\n${buildContext(data)}` },
        ],
        messages: [...history, { role: "user", content: question }],
      });

      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      if (answer) return NextResponse.json({ answer, mode: "ai" });
    } catch (err) {
      console.error("Chatbot AI call failed, using scripted engine:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    }
  }

  return NextResponse.json({ answer: answerQuestion(question, data), mode: "scripted" });
}
