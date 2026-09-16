import { neuronsPerImage, imagesPerFreeDay, postsPerFreeDay } from "@/lib/ai/neurons";
// 7-12 의 표와 대조: 스텝별 장당 / 하루 장수 / 5장짜리 글 편수
const table = [
  { steps: 2, per: 96, day: 104, posts: 20 },
  { steps: 4, per: 173, day: 57, posts: 11 },
  { steps: 6, per: 250, day: 40, posts: 8 },
  { steps: 8, per: 326, day: 30, posts: 6 },
];
let bad = 0;
for (const t of table) {
  const per = Math.round(neuronsPerImage(t.steps));
  const day = imagesPerFreeDay(t.steps);
  const posts = postsPerFreeDay(t.steps, 5);
  const ok = per === t.per && day === t.day && posts === t.posts;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${t.steps}스텝  장당 ${per}(기대 ${t.per})  하루 ${day}장(기대 ${t.day})  5장글 ${posts}편(기대 ${t.posts})`);
}
console.log(`raw 6스텝 = ${neuronsPerImage(6)} (정수가 아니어야 정상)`);
console.log(bad ? "✗ 표와 불일치" : "✓ 7-12 표와 전부 일치");
process.exit(bad ? 1 : 0);
