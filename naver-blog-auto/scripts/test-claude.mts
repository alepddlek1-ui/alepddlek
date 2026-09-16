import { z } from "zod";
import { checkClaude, runClaude, runClaudeJson, extractJson } from "@/lib/claude";

const v = await checkClaude();
console.log("checkClaude:", v);

// 코드펜스가 붙어도 파싱되는지 (순수 함수라 claude 없이도 확인 가능)
console.log("extractJson(fence):", extractJson('여기 있습니다:\n```json\n{"a":1}\n```\n감사합니다'));
console.log("extractJson(bare) :", extractJson('네! {"b":[1,2]} 입니다.'));

if (!v.ok) process.exit(0);

// 긴 한글 프롬프트(2000자 이상)가 stdin 으로 깨지지 않는지
const long = "다음 문장을 세어보고 개수만 숫자로 답하세요.\n" + "한국어 문장입니다. ".repeat(160);
const r = await runClaude(long + "\n\n숫자 하나만 출력하세요.");
console.log("long prompt ok:", r.ok, r.ok ? r.text.trim().slice(0, 40) : r.error);

const j = await runClaudeJson(
  "사과와 배에 대한 짧은 정보를 주세요.",
  z.object({ fruits: z.array(z.object({ name: z.string(), color: z.string() })).min(2) }),
);
console.log("runClaudeJson:", JSON.stringify(j).slice(0, 200));
