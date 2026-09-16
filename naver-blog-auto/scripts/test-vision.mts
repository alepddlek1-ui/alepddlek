import { runClaude } from "@/lib/claude";
const p = process.argv[2];
const r = await runClaude("이 이미지에 어떤 색이 보이는지 한국어로 한 줄로만 답하세요.", { images: [p] });
console.log(r.ok ? "OK: " + r.text.trim().slice(0, 200) : "FAIL: " + r.error);
