/**
 * ★ 네이버 셀렉터 중앙 관리.
 *
 * 여기 값들은 살아 있는 스마트에디터 ONE 에서 클릭까지 확인한 실측값이다.
 * 추론으로 다시 만들 수 없다. 리팩터링·정리·통합의 대상이 아니다.
 *
 * ⚠️ 네이버 DOM 이 바뀌어 안 잡히면, 값을 "지우고 교체"하지 말고
 *    새로 잰 값을 배열 **앞에** 추가하라. 기존 값은 뒤에 남긴다 —
 *    계정·시점·A/B 에 따라 마크업이 다르고, 다른 환경에서는 뒤쪽 값이 맞는다.
 *    (실제로 발행 버튼이 한 환경에서는 iframe 밖, 다른 환경에서는 안이었다.)
 */

export const SEARCH = {
  news: (q: string) =>
    `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1`,
  blog: (q: string) =>
    `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(q)}`,
  image: (q: string) =>
    `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(q)}`,
  googleImage: (q: string) =>
    `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`,
};

export const NAVER = {
  login: "https://nid.naver.com/nidlogin.login",
  home: "https://www.naver.com",
  myBlog: "https://blog.naver.com/MyBlog.naver",
  write: (blogId: string) =>
    `https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`,
};

/** 발행된 게시글 주소인지 — 글쓰기 URL 을 발행 성공으로 오인하지 않기 위한 판정(7-11) */
export const POST_URL_RE = /blog\.naver\.com\/[^/]+\/\d{6,}/;

/** 블로그 "게시글" 링크 패턴. 블로그 홈 링크를 걸러내기 위해 정확히 매칭한다(6-4) */
export const BLOG_POST_HREF_RE = /blog\.naver\.com\/[^/]+\/\d{6,}/;

export const EDITOR = {
  frame: "iframe#mainFrame",

  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],

  /**
   * ⚠️ 7-1 (★최악) — `button:has-text('취소')` 는 툴바의 **'취소선'** 버튼에 부분일치한다.
   *    Playwright 의 has-text 는 부분일치라서, 취소선이 전역으로 켜진 채 글 전체가 타이핑됐다.
   *    틀린 추측: "한국어 물결표(~~)가 마크다운 취소선으로 변환됐다" — DB 초안에 물결표는 0개였다.
   *    → 클래스 기반을 먼저 쓰고, 텍스트를 쓸 땐 팝업 안으로 스코프 + :text-is 정확일치.
   *      :text-is('취소') 는 '취소선' 에 매칭되지 않는다.
   */
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
    ".se-popup-dialog button:text-is('취소')",
    ".se-popup button:text-is('취소')",
  ],

  title: [
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle .se-text-paragraph",
    ".se-title-text",
  ],
  body: [
    ".se-section-text .se-text-paragraph",
    ".se-component-content .se-text-paragraph",
    ".se-main-container",
  ],

  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],

  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],
  // ⚠️ 7-3 — 복원 팝업의 반투명 차단막. 남아 있으면 발행 버튼 클릭이 "조용히" 무시된다.
  popupDim: [".se-popup-dim"],

  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],
  contentComponents: [".se-content .se-component"],

  /**
   * ⚠️ 7-2 — `:has-text('발행')` 은 '예약 발행 0건' 을 누른다. 데이터 속성을 쓴다.
   *    최종 확인 버튼의 `tpb*i.publish` 는 오타가 아니라 실제 값이다(`*` 포함).
   */
  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  /**
   * ⚠️ 7-19 — radio input 은 13×13 이지만 opacity:0 이라 클릭되지 않는다.
   *    실제로 눌러야 하는 건 label(58×18)이고, 누른 뒤 input.checked 를 직접 읽어 확인해야 한다.
   *    ★ 네이버 발행 레이어의 기본값은 "전체공개"다. 확인되지 않으면 발행하지 말고 중단하라.
   */
  visibility: {
    public: { label: 'label[for="open_public"]', input: "#open_public" },
    neighbor: { label: 'label[for="open_neighbor"]', input: "#open_neighbor" },
    both: { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private: { label: 'label[for="open_private"]', input: "#open_private" },
  } as const,

  // ⚠️ 7-18 — 업로드 직후 캡션 칸은 0×0 이다. 이미지 컴포넌트를 클릭해야 펼쳐지고,
  //    그때 `se-is-on` 클래스가 붙는다. 크기 숫자로 판정하지 마라(640×24 / 64×63 둘 다 나왔다).
  caption: [".se-caption"],
  imageComponent: [".se-content .se-component.se-image"],

  // ⚠️ 7-21 — 사진을 넣으면 우측 도크가 자동으로 열려 본문을 덮는다.
  //    도크의 클래스 계열이 환경마다 다르다. 두 계열을 모두 닫고, 없으면 Escape.
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  // ⚠️ 7-6 — 화면 맨 아래 '글감 검색바'. 탈출 클릭 y 좌표를 잘못 잡으면 여기로 타이핑이 샌다.
  //    (실측 y=815) 상수를 추측하지 말고 실제 위치를 재라.
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],

  content: [".se-content"],
} as const;
