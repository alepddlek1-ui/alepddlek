import path from "node:path";
import { extract } from "@/lib/scrape/trends";

const f = (n: string) => "file://" + path.resolve("fixtures", n);
const news = await extract("news", f("search-news.html"));
const blog = await extract("blog", f("search-blog.html"));

console.log("── 뉴스", news.length, "건");
for (const s of news) console.log("  ·", s.title, "|", s.url);
console.log("── 블로그", blog.length, "건");
for (const s of blog) console.log("  ·", s.title, "|", s.url);

const fail: string[] = [];
const titles = [...news, ...blog].map((s) => s.title);
if (titles.some((t) => t.includes("새 창 열림"))) fail.push("`새 창 열림` 노이즈가 남았다 (6-4)");
if (news.some((s) => s.url.includes("help.naver.com"))) fail.push("고객센터 링크가 들어왔다 (6-4)");
if (new Set(news.map((s) => s.url)).size !== news.length) fail.push("같은 URL 이 두 번 들어왔다 (6-4)");
if (!news.some((s) => s.title === "제주도 렌터카 요금 올여름 20% 인상"))
  fail.push("중복 중 '짧은 제목' 쪽이 남지 않았다 (6-4)");
if (titles.some((t) => /광고|더보기/.test(t))) fail.push("노이즈 텍스트가 남았다");
if (blog.some((s) => !/\/\d{6,}/.test(s.url))) fail.push("블로그 홈 링크가 걸러지지 않았다 (6-4)");
if (new Set(blog.map((s) => s.url)).size !== blog.length) fail.push("블로그 URL 중복 (6-4)");

console.log(fail.length ? "\n✗ " + fail.join("\n✗ ") : "\n✓ 수집 필터 전부 통과");
process.exit(fail.length ? 1 : 0);
