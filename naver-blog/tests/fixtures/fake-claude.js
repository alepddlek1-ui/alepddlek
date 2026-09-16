#!/usr/bin/env node
// 테스트용 가짜 claude — 정해진 JSON 만 뱉는다 (파이프라인 자체를 검증하기 위함)
let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
  const draft = {
    title: "이영표가 4-1 대승에서 짚은 후반 40분 장면",
    persona: "결과만 보고 넘어갔다가 쓴소리 제목을 보고 들어온 축구 팬",
    mainKeyword: "이영표",
    subKeywords: ["이민성호", "신민하", "아시안게임 축구"],
    sponsored: false, fontSize: 16,
    sources: ["스포츠조선 김대식 기자, 2026-09-16"],
    tags: ["이영표","이민성호","신민하","엄지성","아시안게임축구","한국카타르"],
    blocks: [
      { type:"text", text:"후반 40분이었습니다.\n카타르가 하프라인 부근에서 프리킥을 올렸습니다.\n이영표 해설위원의 지적이 여기서 나왔습니다." },
      { type:"text", text:"이 종목 기사를 오래 따라 읽다 보면 알게 됩니다.\n대승 뒤의 지적이 대개 진짜입니다." },
      { type:"image", card:"goals", caption:"득점 정리" },
      { type:"subtitle", text:"이민성호가 카타르를 이긴 경기" },
      { type:"text", text:"이민성 감독의 23세 이하 대표팀은 15일 카타르를 4대1로 이겼습니다.\n엄지성이 해트트릭을 기록했습니다." },
      { type:"quote", text: process.env.NB_FAKE_BAD_QUOTE ? "우승은 우리 것이라고 확신한다" : "교체 후 수비 집중력이 흔들린 게 아쉽다" },
      { type:"subtitle", text:"신민하의 그 장면" },
      { type:"text", text:"센터백 신민하가 낙하지점을 포착하지 못했습니다.\n마르완 하산이 마무리했습니다." },
      { type:"image", card:"sequence" },
      { type:"divider" },
      { type:"subtitle", text:"아시안게임 축구 다음 일정" },
      { type:"text", text:"제 판단으로는 시점이 중요합니다.\n이영표 해설위원의 지적이 초반에 나온 것이 다행입니다." },
      { type:"text", text:"정리하면 이렇습니다.\n이영표 해설위원은 대승에도 수비 집중력을 지적했습니다.\n스포츠 이슈 아카이브에 쌓아두고 있습니다." }
    ]
  };
  const cards = { size:"square", cards:[
    { type:"timeline", name:"goals", title:"골 정리", items:[{k:"엄지성",v:"해트트릭"},{k:"후반 40분",v:"카타르 만회골"}] },
    { type:"timeline", name:"sequence", title:"실점 장면", items:[{k:"1",v:"하프라인 프리킥"},{k:"2",v:"신민하 낙하지점 포착 실패"}] }
  ]};
  console.log("```json\n" + JSON.stringify({draft, cards}, null, 2) + "\n```");
});
