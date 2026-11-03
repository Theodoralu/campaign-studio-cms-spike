// design-tokens/palette-engine.js —— 配色推導引擎（單一真源；2026-08-25 使用者拍板 C 案）
// 「主色 → 整組配色」的推導與對比檢查數學住這裡一份：色彩策略工具（經注入器帶入頁內
// PALETTE_ENGINE 塊）與 CMS 端同用這顆，兩邊不各養一份數學。
//
// 契約（跨線協定，改動先知會兩端）：
//   deriveTheme(env) → { themeMode, palette, colors, bgRoles, slots(15＋家族 3＝18 槽), checks, qaStatus, cssVars }
//   env 最小輸入＝{ brandHex, themeMode }（其餘旋鈕見 defaultEnv 預設）；
//   工具端 env＝介面即時狀態（paletteEnv()），CMS 端 env＝調色盤選色＋自家旋鈕。
//   qaStatus 只涵蓋色彩檢查列；宿主自加的檢查（如 Hero 字數）由宿主自行併入。
//   env.heroSurface（2026-09-08）＝標題族實際坐的底（照片版面＝照片代表色 hex）；有傳＝標題／副標／活動時間兩列改對它算、
//   門檻一律 4.5（與 CMS lib/theme_draft checkThemeDraft 同判＝絆線 pipeline/test/unit/readability_parity.test.js）。
//   家族三軌（2026-08-26 兩線協定・使用者裁決）：slots.brand（直通）／brandSoft／brandNeon（brandFamily 推導；
//   十主題照 tokens.json 原值由宿主帶入、自訂 seed 走公式）；cssVars 帶 --campaign-brand-soft/-neon。
//   env.slotOverrides＝18 槽鍵逐槽蓋值（壞值忽略；恆定槽把關＝宿主閘；--campaign-bg-* 不吃槽覆寫）。
// 環境：瀏覽器（window.PaletteEngine）與 Node（require）皆可載。
// 修改守則：真值鐵律照舊（引擎不生成價格/檔期/URL）；改推導公式＝裁決批動作，兩端同步驗收。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PaletteEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var strategyMeta = {
    premium:{label:"高級精品", activity:"精品、美妝、香氛、選品專題", emotion:"精緻、沉穩、信任、低調奢華", s:-28,l:-6,c:12},
    promo:{label:"強促銷", activity:"大促、限時、滿額、節慶檔", emotion:"興奮、急迫、醒目、高行動性", s:30,l:0,c:32},
    tech:{label:"清爽科技", activity:"3C、AI、家電、會員科技感", emotion:"清爽、理性、可靠、未來感", s:-4,l:12,c:10},
    trend:{label:"潮流運動", activity:"球鞋、戶外、運動服飾、街頭品牌", emotion:"年輕、衝突、速度、張力", s:18,l:-4,c:26},
    warm:{label:"溫暖生活", activity:"食品、居家、母嬰、寵物、生活提案", emotion:"溫和、安心、親近、療癒", s:-18,l:16,c:-4},
    morandi:{label:"莫蘭迪低彩", activity:"生活風格、文青選品、保養、家居", emotion:"柔和、安靜、質感、低壓", s:-36,l:10,c:-12},
    contrast:{label:"活潑撞色", activity:"潮流新品、快閃、年輕族群、社群活動", emotion:"活潑、大膽、刺激、吸睛", s:24,l:4,c:28}
  };
  // 預設（bright）＝零調整：選定色盤的套用色＝卡面色，日系色票原味不被靜默加料。
  // （舊值 bright l:+8 會把淺調 Hero 推到近白，日系 preset 的設計色票被沖掉）
  var moodAdjust = {
    stable:{s:-10,l:-2,c:-4},
    bright:{s:0,l:0,c:0},
    bold:{s:14,l:-2,c:16}
  };
  var harmonyLabels = {
    analogous:"類比延伸",
    complementary:"互補 CTA",
    split:"分割互補",
    triadic:"三角色",
    muted:"低彩精品",
    tonal:"同色深淺"
  };
  var jpColors = {
    ruri:{name:"瑠璃",romaji:"RURI",hex:"#1E50A2"},
    mizu:{name:"水",romaji:"MIZU",hex:"#81C7D4"},
    byakugun:{name:"白群",romaji:"BYAKUGUN",hex:"#78C2C4"},
    aimirucha:{name:"藍海松茶",romaji:"AIMIRUCHA",hex:"#0F4C3A"},
    ai:{name:"藍",romaji:"AI",hex:"#0D5661"},
    gunjo:{name:"群青",romaji:"GUNJO",hex:"#51A8DD"},
    konjo:{name:"紺青",romaji:"KONJO",hex:"#113285"},
    tetsukon:{name:"鉄紺",romaji:"TETSUKON",hex:"#0B1013"},
    rikyu:{name:"利休茶",romaji:"RIKYUCHA",hex:"#897D55"},
    shiracha:{name:"白茶",romaji:"SHIRACHA",hex:"#BC9F77"},
    urayanagi:{name:"裏柳",romaji:"URAYANAGI",hex:"#B5CAA0"},
    torinoko:{name:"鳥之子",romaji:"TORINOKO",hex:"#DAC9A6"},
    susutake:{name:"煤竹",romaji:"SUSUTAKE",hex:"#6E552F"},
    uguisu:{name:"鶯",romaji:"UGUISU",hex:"#6C6A2D"},
    benihi:{name:"紅緋",romaji:"BENIHI",hex:"#F75C2F"},
    yamabuki:{name:"山吹",romaji:"YAMABUKI",hex:"#F8B500"},
    kanaria:{name:"金糸雀",romaji:"KANARIA",hex:"#F7D94C"},
    kuchiba:{name:"朽葉",romaji:"KUCHIBA",hex:"#D9AB42"},
    suo:{name:"蘇芳",romaji:"SUO",hex:"#8E354A"},
    benitobi:{name:"紅鳶",romaji:"BENITOBI",hex:"#994639"},
    benikeshinezumi:{name:"紅消鼠",romaji:"BENIKESHINEZUMI",hex:"#B19693"},
    gofun:{name:"胡粉",romaji:"GOFUN",hex:"#FFFFFB"},
    kurotobi:{name:"黒鳶",romaji:"KUROTOBI",hex:"#351E1C"},
    seiji:{name:"青磁",romaji:"SEIJI",hex:"#69B0AC"},
    byakuroku:{name:"白緑",romaji:"BYAKUROKU",hex:"#A8D8B9"},
    wakatake:{name:"若竹",romaji:"WAKATAKE",hex:"#5DAC81"},
    yanaginezumi:{name:"柳鼠",romaji:"YANAGINEZUMI",hex:"#808F7C"},
    sakura:{name:"桜",romaji:"SAKURA",hex:"#FEDFE1"},
    momo:{name:"桃",romaji:"MOMO",hex:"#F596AA"},
    fujinezumi:{name:"藤鼠",romaji:"FUJINEZUMI",hex:"#6E75A4"},
    fuji:{name:"藤",romaji:"FUJI",hex:"#8B81C3"},
    kikyo:{name:"桔梗",romaji:"KIKYO",hex:"#6A4C9C"},
    shion:{name:"紫苑",romaji:"SHION",hex:"#8F77B5"},
    sumi:{name:"墨",romaji:"SUMI",hex:"#1C1C1C"},
    ginnezumi:{name:"銀鼠",romaji:"GINNEZUMI",hex:"#91989F"},
    nezumi:{name:"鼠",romaji:"NEZUMI",hex:"#949495"},
    keshizumi:{name:"消炭",romaji:"KESHIZUMI",hex:"#434343"},
    araishu:{name:"洗朱",romaji:"ARAISHU",hex:"#C73E3A"},
    enji:{name:"臙脂",romaji:"ENJI",hex:"#9F353A"},
    hiwada:{name:"檜皮",romaji:"HIWADA",hex:"#854836"},
    karakurenai:{name:"韓紅",romaji:"KARAKURENAI",hex:"#D0104C"},
    nakabeni:{name:"中紅",romaji:"NAKABENI",hex:"#DB4D6D"},
    botan:{name:"牡丹",romaji:"BOTAN",hex:"#C1328E"},
    hiwa:{name:"鶸",romaji:"HIWA",hex:"#BEC23F"},
    koke:{name:"苔",romaji:"KOKE",hex:"#838A2D"},
    nando:{name:"納戸",romaji:"NANDO",hex:"#0089A7"},
    hanaasagi:{name:"花浅葱",romaji:"HANAASAGI",hex:"#1E88A8"},
    toki:{name:"鴇",romaji:"TOKI",hex:"#EEA9A9"},
    haizakura:{name:"灰桜",romaji:"HAIZAKURA",hex:"#D7C4BB"},
    yamabato:{name:"山鳩",romaji:"YAMABATO",hex:"#767C6B"}
  };
  function toneColor(key,note){var c=jpColors[key];return {name:c.name,romaji:c.romaji,hex:c.hex,note:note}}
  function nipponPreset(id,category,label,activity,emotion,family,brand,hero,headline,cta,price,accent,text){
    return {
      id:id,category:category,label:label,activity:activity,emotion:emotion,family:family,
      source:"Nippon Colors 風格參考：" + [brand,hero,headline,cta,price,accent].map(function(k){return jpColors[k].name}).join(" / "),
      colors:{
        brand:jpColors[brand].hex,
        hero:mixHex(jpColors[hero].hex,"#FFFFFF",82),
        headline:jpColors[headline].hex,
        cta:jpColors[cta].hex,
        price:jpColors[price].hex,
        discount:jpColors[price].hex, /* 折數角色（2026-09-27 使用者拍板：hero 價格與折數各自獨立可設）：預設值同 price 那支暖色、但是獨立角色——設計師改 Price 不會連動它 */
        accent:jpColors[accent].hex,
        surface:"#FFFDFC",
        text:jpColors[text || headline].hex
      },
      references:{
        brand:toneColor(brand,"主色，建立活動頁的色彩記憶點"),
        hero:toneColor(hero,"轉成高明度 Hero 背景，保留色感但降低壓迫"),
        headline:toneColor(headline,"標題文字色，優先確保可讀性"),
        price:toneColor(price,"價格或促購資訊，用少量暖色形成行動提醒"),
        accent:toneColor(accent,"輔助點綴色，銜接情緒與視覺層次")
      }
    };
  }
  var nipponList = [
    ["suo_premium","premium","蘇芳精品紅","精品、美妝、香氛、會員高端檔","成熟、深邃、優雅、低調奢華","pink-plum","suo","gofun","kurotobi","suo","benitobi","benikeshinezumi","kurotobi"],
    ["fujinezumi_premium","premium","藤鼠高級灰紫","精品選物、香氛、時尚專題","冷靜、克制、細膩、知性","mono","fujinezumi","haizakura","sumi","fujinezumi","nakabeni","shion","sumi"],
    ["enji_premium","premium","臙脂禮盒紅","節慶禮盒、高端會員、精品促購","濃郁、儀式、尊貴、穩重","pink-plum","enji","gofun","kurotobi","enji","benihi","haizakura","kurotobi"],
    ["hiwada_premium","premium","檜皮皮革棕","皮件、鞋包、男裝、工藝精品","溫厚、復古、材質感、信任","gold-bronze","hiwada","torinoko","sumi","hiwada","benitobi","shiracha","sumi"],
    ["kikyo_premium","premium","桔梗深紫","珠寶、夜間檔、香氛、時尚 editorial","神秘、靜謐、精緻、夜色感","mono","kikyo","gofun","sumi","kikyo","suo","shion","sumi"],
    ["sumi_premium","premium","墨黑極簡","高端選品、設計師聯名、黑白精品","極簡、權威、安靜、設計感","mono","sumi","ginnezumi","sumi","sumi","benihi","ginnezumi","sumi"],
    ["benikeshinezumi_premium","premium","紅消鼠柔奢","保養、美妝、柔霧精品","柔和、成熟、低彩、精緻","pink-plum","benikeshinezumi","gofun","kurotobi","suo","benitobi","haizakura","kurotobi"],
    ["ginnezumi_premium","premium","銀鼠都會精品","3C 精品、都會配件、會員高端","冷靜、都會、理性、金屬感","mono","ginnezumi","gofun","sumi","fujinezumi","benihi","nezumi","sumi"],
    ["rikyu_lifestyle","lifestyle","利休生活茶","食品、茶器、居家、生活提案","自然、溫潤、安定、侘寂","green-sage","rikyu","shiracha","sumi","rikyu","hiwada","urayanagi","sumi"],
    ["shiracha_lifestyle","lifestyle","白茶居家暖色","居家、母嬰、食品、生活風格","柔軟、安心、日常、溫暖","gold-bronze","shiracha","torinoko","hiwada","rikyu","benitobi","urayanagi","hiwada"],
    ["susutake_lifestyle","lifestyle","煤竹工藝棕","家具、家電、露營、職人選物","厚實、自然、工藝、可靠","gold-bronze","susutake","torinoko","sumi","susutake","benitobi","rikyu","sumi"],
    ["urayanagi_lifestyle","lifestyle","裏柳自然綠","植栽、保養、生活選物、永續","柔和、自然、低壓、清新","green-sage","urayanagi","gofun","aimirucha","wakatake","araishu","byakuroku","aimirucha"],
    ["torinoko_lifestyle","lifestyle","鳥之子紙感","文具、書籍、食品、日系生活","紙感、溫潤、樸素、安定","gold-bronze","torinoko","gofun","hiwada","rikyu","benitobi","shiracha","hiwada"],
    ["uguisu_lifestyle","lifestyle","鶯綠日常","食品、茶飲、戶外生活、自然選品","安靜、自然、沉著、有機","green-sage","uguisu","byakuroku","sumi","uguisu","hiwada","urayanagi","sumi"],
    ["yamabato_lifestyle","lifestyle","山鳩灰綠","居家、服飾、慢生活、戶外","柔和、沉穩、霧面、自然","green-sage","yamabato","gofun","sumi","rikyu","benitobi","urayanagi","sumi"],
    ["ruri_tech","tech","瑠璃科技藍","3C、AI、會員科技感、清爽新品","冷靜、精密、透明、信任","blue-calm","ruri","mizu","tetsukon","ruri","benitobi","byakugun","sumi"],
    ["nando_tech","tech","納戸數位青","SaaS、會員、金融科技、3C","清楚、可靠、專業、未來感","blue-calm","nando","byakugun","tetsukon","nando","araishu","mizu","tetsukon"],
    ["gunjo_tech","tech","群青新品藍","科技新品、家電、智慧生活","明亮、可靠、開放、清爽","blue-calm","gunjo","mizu","tetsukon","ruri","benihi","byakugun","tetsukon"],
    ["hanaasagi_tech","tech","花浅葱清透藍","夏季 3C、會員活動、資訊頁","透明、輕盈、乾淨、理性","blue-calm","hanaasagi","mizu","tetsukon","hanaasagi","araishu","byakugun","tetsukon"],
    ["konjo_tech","tech","紺青深科技","高階 3C、AI、金融會員","深度、專業、穩定、高端","blue-calm","konjo","gofun","tetsukon","konjo","benihi","gunjo","tetsukon"],
    ["ai_tech","tech","藍綠資料感","資料服務、科技會員、B2B","理性、清爽、可信、專業","blue-calm","ai","byakugun","tetsukon","nando","araishu","mizu","tetsukon"],
    ["yamabuki_festival","festival","山吹節慶金","節慶、禮盒、促銷、開幕檔","明亮、慶賀、熱度、行動性","gold-bronze","yamabuki","torinoko","sumi","benihi","benihi","kanaria","sumi"],
    ["benihi_festival","festival","紅緋大促","限時促銷、年節、快閃","熱烈、急迫、醒目、購買衝動","pink-plum","benihi","gofun","sumi","benihi","enji","yamabuki","sumi"],
    ["kanaria_festival","festival","金糸雀明亮促購","春夏促銷、童趣、開幕活動","明亮、歡快、醒目、親切","gold-bronze","kanaria","gofun","sumi","benihi","araishu","yamabuki","sumi"],
    ["kuchiba_festival","festival","朽葉秋收禮盒","中秋、食品、秋季禮盒","成熟、收穫、溫暖、季節感","gold-bronze","kuchiba","torinoko","hiwada","hiwada","benitobi","yamabuki","hiwada"],
    ["karakurenai_festival","festival","韓紅節慶粉紅","美妝節慶、女性檔、禮盒","華麗、明快、柔中帶衝擊","pink-plum","karakurenai","sakura","sumi","karakurenai","benihi","momo","sumi"],
    ["sakura_festival","festival","桜春日促購","春季、櫻花季、美妝、甜點","輕盈、浪漫、季節、愉悅","pink-plum","sakura","gofun","kurotobi","momo","benihi","haizakura","kurotobi"],
    ["seiji_wellness","wellness","青磁清爽綠","保養、夏季、生活風格、清爽選品","清透、柔和、療癒、低壓","green-sage","seiji","byakuroku","aimirucha","seiji","araishu","wakatake","aimirucha"],
    ["byakuroku_wellness","wellness","白緑保養霧色","保養、醫美、健康食品","柔和、潔淨、修護、安心","green-sage","byakuroku","gofun","aimirucha","wakatake","araishu","seiji","aimirucha"],
    ["wakatake_wellness","wellness","若竹活力自然","運動保健、有機、戶外生活","新鮮、健康、自然、活力","green-sage","wakatake","byakuroku","aimirucha","wakatake","benihi","urayanagi","aimirucha"],
    ["yanaginezumi_wellness","wellness","柳鼠低彩療癒","保養、睡眠、舒壓、香氛","低彩、安靜、療癒、柔霧","green-sage","yanaginezumi","gofun","sumi","yanaginezumi","benitobi","byakuroku","sumi"],
    ["mizu_wellness","wellness","水色清涼保養","夏日保養、飲品、清潔用品","清涼、透明、輕盈、潔淨","blue-calm","mizu","gofun","tetsukon","hanaasagi","araishu","byakugun","tetsukon"],
    ["haizakura_wellness","wellness","灰桜柔霧美妝","敏感肌、美妝、香氛、內衣","柔霧、溫柔、細膩、低壓","pink-plum","haizakura","gofun","kurotobi","benikeshinezumi","benitobi","sakura","kurotobi"],
    ["sakura_seasonal","seasonal","桜春季限定","春季限定、甜點、美妝、旅遊","浪漫、輕盈、新生、季節感","pink-plum","sakura","gofun","kurotobi","momo","benihi","haizakura","kurotobi"],
    ["fuji_seasonal","seasonal","藤花初夏","初夏、香氛、女性選品","優雅、清爽、花季、柔和","mono","fuji","gofun","sumi","fujinezumi","nakabeni","shion","sumi"],
    ["koke_seasonal","seasonal","苔綠雨季","雨季、戶外、保養、茶飲","濕潤、沉著、自然、靜謐","green-sage","koke","byakuroku","sumi","uguisu","hiwada","urayanagi","sumi"],
    ["kuchiba_seasonal","seasonal","朽葉秋季","秋季、服飾、禮盒、食品","成熟、溫暖、收斂、季節","gold-bronze","kuchiba","torinoko","hiwada","hiwada","benitobi","shiracha","hiwada"],
    ["tetsukon_seasonal","seasonal","鉄紺冬夜","冬季、男裝、科技、夜間檔","深沉、冷冽、安定、夜色","mono","tetsukon","ginnezumi","tetsukon","ruri","benihi","nando","tetsukon"],
    ["toki_seasonal","seasonal","鴇粉限定","春夏女裝、美妝、甜點","柔亮、甜感、友善、季節","pink-plum","toki","gofun","kurotobi","momo","benihi","sakura","kurotobi"],
    ["karakurenai_trend","trend","韓紅潮流粉","潮流新品、社群、女性運動","大膽、鮮明、社群感、活力","pink-plum","karakurenai","gofun","sumi","karakurenai","benihi","kanaria","sumi"],
    ["botan_trend","trend","牡丹鮮明紫粉","潮流美妝、聯名、社群主視覺","華麗、醒目、張力、流行","pink-plum","botan","sakura","sumi","botan","benihi","fuji","sumi"],
    ["nando_trend","trend","納戸撞色街頭","潮流服飾、運動、街頭品牌","冷熱對比、速度、張力、現代","blue-calm","nando","gofun","tetsukon","nando","benihi","kanaria","tetsukon"],
    ["hiwa_trend","trend","鶸黃綠潮流","年輕族群、戶外機能、快閃","新鮮、刺激、醒目、活潑","green-sage","hiwa","gofun","sumi","koke","benihi","kanaria","sumi"],
    ["benihi_trend","trend","紅緋高衝擊","大促、運動、街頭、限時檔","高能量、強行動、直接、醒目","pink-plum","benihi","gofun","sumi","benihi","enji","yamabuki","sumi"],
    ["hanaasagi_trend","trend","花浅葱清亮潮流","運動、美妝新品、夏季快閃","清亮、活力、年輕、透明","blue-calm","hanaasagi","gofun","tetsukon","hanaasagi","benihi","kanaria","tetsukon"],
    ["susutake_craft","craft","煤竹職人工藝","職人品牌、工藝、器物、選品","手感、厚度、文化、可信","gold-bronze","susutake","torinoko","sumi","susutake","benitobi","rikyu","sumi"],
    ["ai_craft","craft","藍染職人","藍染、服飾、工藝、文化專題","沉靜、手作、傳統、耐看","blue-calm","ai","gofun","tetsukon","ai","benitobi","mizu","tetsukon"],
    ["rikyu_craft","craft","利休茶道","茶器、食品、文化體驗","禪意、靜謐、儀式、自然","green-sage","rikyu","torinoko","sumi","rikyu","hiwada","urayanagi","sumi"],
    ["hiwada_craft","craft","檜皮古物","古物、皮革、文具、咖啡","復古、沉穩、材質、故事","gold-bronze","hiwada","shiracha","sumi","hiwada","benitobi","susutake","sumi"],
    ["sumi_craft","craft","墨色書藝","書法、展覽、文化、設計師企劃","克制、力量、文化、留白","mono","sumi","gofun","sumi","sumi","benihi","ginnezumi","sumi"]
  ].map(function(p){return nipponPreset.apply(null,p)});
  var nipponPalettes = {};
  nipponList.forEach(function(p){nipponPalettes[p.id]=p});
  /* discount／discountBadge／discountBadgeText（2026-09-27 使用者裁決牆 qa/hero-price-discount-color-wall-2026-09-27：Q2 改題＝折數獨立角色不掛 Price；Q3 乙＝圓章底、字各一列） */
  var moduleMappingDefaults = {page:"page",hero:"hero",section:"section",card:"card",product:"product",eyebrow:"accent",cta:"cta",price:"price",discount:"discount",discountBadge:"accent",discountBadgeText:"text",title:"headline",subtitle:"text",eventLabel:"text",eventDate:"headline",cardBadge:"accent",titleBadge:"accent",latticeLine:"accent"};
  // 色票的應對元件清單（映射面板列＝色票卡「應對元件」反查的同一份真值）
  var moduleComponents = [
    ["page","活動頁底色"],
    ["hero","Hero 背景"],
    ["section","區塊背景"],
    ["card","內容卡片"],
    ["product","商品展示底"],
    ["eyebrow","標籤 / Badge"],
    ["cta","CTA 按鈕"],
    ["price","價格文字"],
    ["discount","活動標題折扣數字"],
    ["discountBadge","折扣圓章底"],
    ["discountBadgeText","折扣圓章字"],
    ["title","主標題文字"],
    ["subtitle","副標題文字"],
    ["eventLabel","活動時間標題"],
    ["eventDate","活動時間日期"],
    ["cardBadge","商品卡特色標"],
    ["titleBadge","活動標題特色標"],
    ["latticeLine","底紋線色（pattern 背景）"]
  ];
  function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
  function mod(n,m){return ((n%m)+m)%m}
  function hexToRgb(hex){
    hex = String(hex || "").trim();
    if(hex[0] !== "#") hex = "#" + hex;
    if(/^#[0-9a-f]{3}$/i.test(hex)){
      hex = "#" + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    }
    if(!/^#[0-9a-f]{6}$/i.test(hex)) return null;
    var n = parseInt(hex.slice(1),16);
    return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
  }
  function rgbToHex(rgb){
    return "#" + [rgb.r,rgb.g,rgb.b].map(function(v){
      return clamp(Math.round(v),0,255).toString(16).padStart(2,"0");
    }).join("").toUpperCase();
  }
  function rgbToHsl(rgb){
    var r=rgb.r/255,g=rgb.g/255,b=rgb.b/255;
    var max=Math.max(r,g,b),min=Math.min(r,g,b),h,s,l=(max+min)/2;
    if(max===min){h=0;s=0}else{
      var d=max-min;
      s=l>.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r:h=(g-b)/d+(g<b?6:0);break;
        case g:h=(b-r)/d+2;break;
        default:h=(r-g)/d+4;
      }
      h*=60;
    }
    return {h:h,s:s*100,l:l*100};
  }
  function hslToRgb(hsl){
    var h=mod(hsl.h,360)/360,s=clamp(hsl.s,0,100)/100,l=clamp(hsl.l,0,100)/100;
    if(s===0){var v=Math.round(l*255);return {r:v,g:v,b:v}}
    function hue2rgb(p,q,t){
      if(t<0)t+=1;if(t>1)t-=1;
      if(t<1/6)return p+(q-p)*6*t;
      if(t<1/2)return q;
      if(t<2/3)return p+(q-p)*(2/3-t)*6;
      return p;
    }
    var q=l<.5?l*(1+s):l+s-l*s;
    var p=2*l-q;
    return {r:hue2rgb(p,q,h+1/3)*255,g:hue2rgb(p,q,h)*255,b:hue2rgb(p,q,h-1/3)*255};
  }
  function hslHex(h,s,l){return rgbToHex(hslToRgb({h:h,s:s,l:l}))}
  function mixHex(a,b,amount){
    var ar=hexToRgb(a), br=hexToRgb(b), t=clamp(amount,0,100)/100;
    return rgbToHex({r:ar.r*(1-t)+br.r*t,g:ar.g*(1-t)+br.g*t,b:ar.b*(1-t)+br.b*t});
  }
  function contrast(hex1,hex2){
    function lum(hex){
      var rgb=hexToRgb(hex);
      var a=[rgb.r,rgb.g,rgb.b].map(function(v){
        v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4);
      });
      return .2126*a[0]+.7152*a[1]+.0722*a[2];
    }
    var l1=lum(hex1),l2=lum(hex2),hi=Math.max(l1,l2),lo=Math.min(l1,l2);
    return (hi+.05)/(lo+.05);
  }
  function bestText(bg){return contrast("#111111",bg) >= contrast("#FFFFFF",bg) ? "#111111" : "#FFFFFF"}
  // 家族三軌推導（2026-08-26 使用者裁決＝自訂調色盤要能控新模組主色件；兩線協定 brand/brandSoft/brandNeon）
  // 十主題照 tokens.json 原值（CMS 十主題鏈）；自訂 seed 走本公式——擬合目標＝tokens 十主題 primary/secondary/highlight：
  // 輔助＝同色相微調（亮：S×.9、L+6／暗：S×1.05、L−7）；螢光＝互補高彩（結果色相落黃綠帶＝中明度、其餘高明度），暖金帶（H 20–65）例外＝同相提亮
  function brandFamily(brandHex, themeMode){
    var rgb = hexToRgb(brandHex) || hexToRgb("#2F68D8");
    var h = rgbToHsl(rgb);
    var soft = themeMode === "dark"
      ? hslHex(h.h, clamp(h.s*1.05,6,96), clamp(h.l-7,12,90))
      : hslHex(h.h, clamp(h.s*0.9,6,96), clamp(h.l+6,12,90));
    var neon;
    if (h.h >= 20 && h.h < 65) {
      neon = hslHex(h.h, 100, clamp(Math.max(h.l+40,68),55,86));
    } else {
      var nh = mod(h.h+180,360);
      var nl = (nh >= 45 && nh <= 90) ? 62 : 78;
      neon = hslHex(nh, Math.max(90, h.s), nl);
    }
    return { brandSoft: soft, brandNeon: neon };
  }
  function colorDistance(a,b){
    var ah=rgbToHsl(hexToRgb(a)), bh=rgbToHsl(hexToRgb(b));
    var dh=Math.min(Math.abs(ah.h-bh.h),360-Math.abs(ah.h-bh.h))/180;
    var ds=Math.abs(ah.s-bh.s)/100;
    var dl=Math.abs(ah.l-bh.l)/100;
    return dh*2.4 + ds*.8 + dl*.8;
  }
  function nearestNipponPalette(hex){
    var base = hexToRgb(hex) ? rgbToHex(hexToRgb(hex)) : "#2F68D8";
    return nipponList.slice().sort(function(a,b){
      return colorDistance(base,a.colors.brand) - colorDistance(base,b.colors.brand);
    })[0] || nipponList[0];
  }
  function guidedPalette(baseHex,harmony){
    var nearest = nearestNipponPalette(baseHex);
    var base = rgbToHsl(hexToRgb(baseHex));
    var colors = Object.assign({}, nearest.colors);
    colors.brand = rgbToHex(hexToRgb(baseHex));
    if (harmony === "analogous") {
      colors.cta = hslHex(base.h + 18, clamp(base.s + 8,24,82), 42);
      colors.accent = hslHex(base.h - 24, clamp(base.s - 12,14,56), 68);
    } else if (harmony === "complementary") {
      colors.cta = hslHex(base.h + 180, clamp(base.s + 12,28,86), 40);
      colors.accent = hslHex(base.h + 24, clamp(base.s - 14,14,52), 70);
    } else if (harmony === "split") {
      colors.cta = hslHex(base.h + 150, clamp(base.s + 8,28,84), 42);
      colors.accent = hslHex(base.h + 210, clamp(base.s - 6,18,66), 70);
    } else if (harmony === "triadic") {
      colors.cta = hslHex(base.h + 120, clamp(base.s + 4,24,78), 42);
      colors.accent = hslHex(base.h + 240, clamp(base.s - 8,18,64), 68);
    } else if (harmony === "muted") {
      colors.cta = hslHex(base.h, clamp(base.s*.42,10,36), clamp(base.l - 10,34,52));
      colors.accent = hslHex(base.h + 20, clamp(base.s*.28,8,28), 72);
    } else if (harmony === "tonal") {
      colors.cta = hslHex(base.h, clamp(base.s + 8,24,72), clamp(base.l - 16,32,48));
      colors.accent = hslHex(base.h, clamp(base.s - 18,10,42), 74);
    }
    colors.hero = hslHex(base.h, harmony === "muted" ? clamp(base.s*.16,4,18) : clamp(base.s*.22,6,26), 96);
    colors.surface = hslHex(base.h, clamp(base.s*.08,2,12), 99);
    colors.headline = hslHex(base.h, clamp(base.s*.34,8,38), 14);
    colors.text = contrast("#344054",colors.hero) >= 4.5 ? "#344054" : bestText(colors.hero);
    colors.price = colors.price || "#D75455";
    colors.discount = colors.discount || colors.price; /* 折數角色：缺＝跟 price 同值起步（獨立角色，見 nipponPreset 註） */
    return Object.assign({}, nearest, {
      label:"自訂引導｜接近 " + nearest.label,
      strategy:"custom-guided",
      emotion:nearest.emotion + "；依 " + harmony + " 調和方式轉譯",
      source:"自訂主色 + 日本傳統色盤近似：" + nearest.label,
      colors:colors
    });
  }
  function generatedPalette(baseHex,harmony,label,activity,emotion,strategyValue){
    var generated = guidedPalette(baseHex,harmony);
    return Object.assign({}, generated, {
      id:"generated_" + harmony + "_" + rgbToHex(hexToRgb(baseHex)).slice(1).toLowerCase(),
      label:label || (harmonyLabels[harmony] || harmony),
      activity:activity || generated.activity,
      emotion:emotion || generated.emotion,
      source:"主色 " + rgbToHex(hexToRgb(baseHex)) + " + " + (harmonyLabels[harmony] || harmony),
      family:suggestFamily(rgbToHsl(hexToRgb(baseHex)), strategyValue),
      colors:generated.colors
    });
  }
  function resultFromPreset(preset,strategyName,env){
    var presetBase = rgbToHsl(hexToRgb(preset.colors.brand));
    return applyPaletteTuning(env,{
      base:presetBase,
      strategy:strategyName,
      meta:{
        label:preset.label,
        activity:preset.activity,
        emotion:preset.emotion + "（" + preset.source + "）"
      },
      family:preset.family,
      nippon:preset,
      colors:{
        brand:preset.colors.brand,
        hero:preset.colors.hero,
        headline:preset.colors.headline,
        cta:preset.colors.cta,
        price:preset.colors.price,
        discount:preset.colors.discount || preset.colors.price,
        accent:preset.colors.accent,
        surface:preset.colors.surface,
        text:preset.colors.text,
        ctaText:bestText(preset.colors.cta),
        accentText:bestText(preset.colors.accent)
      }
    });
  }
  function tuneHex(hex,satDelta,lightDelta){
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var hsl = rgbToHsl(rgb);
    return hslHex(hsl.h, clamp(hsl.s + satDelta,0,100), clamp(hsl.l + lightDelta,0,100));
  }
  function applyPaletteTuning(env,result){
    var mood = moodAdjust[env.mood] || moodAdjust.bright;
    var sat = (Number(env.sat) || 0) + mood.s;
    var light = (Number(env.light) || 0) + mood.l;
    var cont = (Number(env.contrast) || 0) + mood.c;
    if (!sat && !light && !cont) return result;
    var colors = Object.assign({}, result.colors);
    colors.hero = tuneHex(colors.hero, sat * .42, light * .9 + cont * .12);
    colors.surface = tuneHex(colors.surface, sat * .22, light * .45 + cont * .08);
    colors.headline = tuneHex(colors.headline, sat * .36, light * .2 - cont * .42);
    colors.cta = tuneHex(colors.cta, sat * .86 + cont * .18, light * .28 - cont * .08);
    colors.price = tuneHex(colors.price, sat * .78 + cont * .14, light * .18 - cont * .05);
    colors.discount = tuneHex(colors.discount || colors.price, sat * .78 + cont * .14, light * .18 - cont * .05); /* 折數：微調係數同 price（同屬促購暖色族） */
    colors.accent = tuneHex(colors.accent, sat * .72, light * .5);
    colors.text = contrast("#344054",colors.hero) >= 4.5 ? "#344054" : bestText(colors.hero);
    colors.ctaText = bestText(colors.cta);
    colors.accentText = bestText(colors.accent);
    return Object.assign({}, result, {colors:colors});
  }
  // 明暗主題共用同一個主色：
  // Light＝主色調亮當背景（高明度、低彩度）＋深色文字。
  // Dark＝把主色整個加深（深色系而非黑色系）：降明度但保留彩度——
  //   粉紅→棗紅、天藍→深海藍、鵝黃→橄欖、嫩綠→森林綠；文字換亮色、CTA／價格／點綴提亮。
  //   色相一律以主色為錨：preset 淺底 hero 色票的色相不帶進深色版——淺色時的低語色相
  //   深色時會變主導，且近白色票（如 #FFFFFE）的 HSL 色相／彩度是捨入假象不可信。
  //   灰階主色（S<12）維持墨色系深灰：不強加彩度，彩度滑桿也不加色。
  function deepSat(s,mult,min,max){
    if (s < 12) return clamp(s,3,12);
    var target = clamp(s*mult,min,max);
    // 12~32 線性接橋：低彩主色（莫蘭迪、精品灰調）保持低彩深色，避免 S=12 斷崖突跳
    if (s < 32) return clamp(12 + (s-12)*(target-12)/20, 3, max);
    return target;
  }
  // 亮底方向的保底：往深壓到「自身文字」（不給 bg）或「對淺色底」（給 bg）達標為止。
  // 越深白字對比越高，必收斂；深底方向另有 liftForSeparation。
  function deepenForContrast(hex,target,bg){
    var hsl = rgbToHsl(hexToRgb(hex));
    var ok = function(){
      var c = hslHex(hsl.h,hsl.s,hsl.l);
      return bg ? contrast(c,bg) >= target : contrast(c,bestText(c)) >= target;
    };
    for (var i=0; i<44 && !ok() && hsl.l > 8; i++) {
      hsl.l = clamp(hsl.l - 2,8,100);
    }
    return hslHex(hsl.h,hsl.s,hsl.l);
  }
  function liftForSeparation(hex,bg,target,textTarget){
    var hsl = rgbToHsl(hexToRgb(hex));
    var ok = function(){
      var c = hslHex(hsl.h,hsl.s,hsl.l);
      // 提亮到兩個門檻同時滿足：跳出深底＋（承載文字的角色）避開黑白字都不夠的中明度死區
      return contrast(c,bg) >= target && (!textTarget || contrast(c,bestText(c)) >= textTarget);
    };
    for (var i=0; i<30 && !ok() && hsl.l < 88; i++) {
      hsl.l = clamp(hsl.l + 3,0,88);
    }
    return hslHex(hsl.h,hsl.s,hsl.l);
  }
  function applyThemeMode(result, env){
    var mode = env.themeMode || "light";
    if (mode !== "dark") {
      // 亮底保底：工具生成的色不該產出過不了自家 QA 的候選——
      // CTA 自身文字 ≥4.5、價格對卡底 ≥3。價格用 surface（近白）代理實際卡底（L97 粉彩 tint），
      // tint 會吃掉約一成對比，target 3.6 留足餘裕
      var lightColors = Object.assign({}, result.colors);
      lightColors.cta = deepenForContrast(lightColors.cta, 4.5);
      lightColors.price = deepenForContrast(lightColors.price, 3.6, lightColors.surface);
      /* 折數坐的是 hero 底（不是卡底）、字級大＝門檻 3；缺欄退 price 同值起步 */
      lightColors.discount = deepenForContrast(lightColors.discount || lightColors.price, 3, lightColors.hero);
      lightColors.ctaText = bestText(lightColors.cta);
      // 亮底 Hero 的色相也要讀得出來：「真中性」（RGB 色偏 <5%）才以主色補淺色。
      // 判斷不可用 HSL 彩度——高明度端 HSL 彩度虛高，日系 preset 的淺調 Hero（色偏約 7%、
      // 色相來自另一支設計色票）會被誤判重繪、日系風格被抹平；灰階主色豁免、維持中性。
      var lightBase = result.base || rgbToHsl(hexToRgb(lightColors.brand));
      var heroRgb = hexToRgb(lightColors.hero);
      var heroChroma = (Math.max(heroRgb.r,heroRgb.g,heroRgb.b) - Math.min(heroRgb.r,heroRgb.g,heroRgb.b)) / 255;
      if (lightBase.s >= 12 && heroChroma < .05) {
        // 主色補淺色重算不可蓋掉 applyPaletteTuning 調過的 hero——把同一組微調量（滑桿＋快速情緒）
        // 用同一組係數帶回來；全零（預設）＝tuneHex 零位移＝原值不變（2026-08-27 使用者報修：
        // 自訂主色模式下彩度/明度/對比拉了、Hero 底色紋風不動——此路只有自訂/品牌模式的近中性 hero 會走進來）
        var tuneMood = moodAdjust[env.mood] || moodAdjust.bright;
        var tSat = (Number(env.sat) || 0) + tuneMood.s;
        var tLight = (Number(env.light) || 0) + tuneMood.l;
        var tCont = (Number(env.contrast) || 0) + tuneMood.c;
        lightColors.hero = tuneHex(hslHex(lightBase.h, clamp(lightBase.s * .7, 30, 65), 93), tSat * .42, tLight * .9 + tCont * .12);
      }
      return Object.assign({}, result, {themeMode:"light", colors:lightColors});
    }
    var base = result.base || rgbToHsl(hexToRgb(result.colors.brand));
    var colors = Object.assign({}, result.colors);
    var satAdj = Number(env.sat) || 0;
    var lightAdj = Number(env.light) || 0;
    var satBoost = base.s < 12 ? 0 : satAdj*.4;
    colors.hero = hslHex(base.h,
      clamp(deepSat(base.s,.72,32,62) + satBoost, 3, 68),
      clamp((base.s > 70 ? 28 : 30) + lightAdj*.2, 24, 34));
    colors.surface = hslHex(base.h, deepSat(base.s,.5,20,44), clamp(33 + lightAdj*.2, 30, 38));
    var inkTint = hslHex(base.h, clamp(base.s*.2,4,18), 95);
    colors.headline = contrast(inkTint,colors.hero) >= 4.5 ? inkTint : bestText(colors.hero);
    var bodyTint = hslHex(base.h, clamp(base.s*.14,3,14), 88);
    if (contrast(bodyTint,colors.hero) < 4.5) bodyTint = hslHex(base.h, clamp(base.s*.1,2,10), 93);
    colors.text = contrast(bodyTint,colors.hero) >= 4.5 ? bodyTint : bestText(colors.hero);
    colors.cta = liftForSeparation(tuneHex(colors.cta,12,4), colors.hero, 2, 4.5);
    colors.price = liftForSeparation(tuneHex(colors.price,8,10), colors.surface, 3);
    colors.discount = liftForSeparation(tuneHex(colors.discount || colors.price,8,10), colors.hero, 3); /* 折數對深底 hero 提亮＝同 price 邏輯、底換成它真正坐的 hero */
    colors.accent = liftForSeparation(tuneHex(colors.accent,8,4), colors.hero, 1.8);
    colors.ctaText = bestText(colors.cta);
    colors.accentText = bestText(colors.accent);
    return Object.assign({}, result, {
      themeMode:"dark",
      meta:Object.assign({}, result.meta, {
        emotion:result.meta.emotion + "；Dark theme＝主色加深的深色版（不是黑底），濃郁沉浸、文字換亮色、CTA 與價格提亮"
      }),
      colors:colors
    });
  }
  function applyDesignerOverrides(result, env){
    var colors = Object.assign({}, result.colors);
    colors.discount = colors.discount || colors.price; /* 任何來路的調色盤都要有 discount 角色，覆寫面板那格才接得上（2026-09-27） */
    Object.keys(env.colorOverrides || {}).forEach(function(key){
      var rgb = hexToRgb(env.colorOverrides[key]);
      if (rgb && colors[key]) colors[key] = rgbToHex(rgb);
    });
    colors.ctaText = bestText(colors.cta);
    colors.accentText = bestText(colors.accent);
    colors.text = colors.text || (contrast("#344054",colors.hero) >= 4.5 ? "#344054" : bestText(colors.hero));
    // systemColors＝套覆寫前的系統推薦值，覆寫面板 placeholder 用它當對照
    return Object.assign({}, result, {systemColors:result.colors, colors:colors});
  }
  function mappedColor(colors,mapping,moduleKey,fallback){
    var role = (mapping || moduleMappingDefaults)[moduleKey] || fallback;
    return colors[role] || colors[fallback] || fallback;
  }
  function backgroundPalette(colors, env){
    var mode = env.themeMode || "light";
    var mapping = env.moduleMapping || moduleMappingDefaults;
    var roleColor = function(key,fallback){
      return colors[mapping[key]] || colors[fallback] || fallback;
    };
    var hero = roleColor("hero","hero");
    var surface = colors.surface;
    var brandHsl = rgbToHsl(hexToRgb(colors.brand));
    var heroHsl = rgbToHsl(hexToRgb(hero));
    // 近白防護只管系統衍生色：設計師明確覆寫的近白（如純白 Hero）原樣進預覽與 QA，
    // 不靜默換色（否則覆寫紀錄與預覽/交付變兩個真值）；對比不足由可讀性檢查出聲
    if (mode === "light" && heroHsl.l > 97 && heroHsl.s < 8 && !(env.colorOverrides && env.colorOverrides.hero)) {
      hero = hslHex(brandHsl.h, clamp(brandHsl.s * .16,8,24), 94);
      heroHsl = rgbToHsl(hexToRgb(hero));
    }
    // Dark 背景階梯＝同色相深調由深到浮：頁面 L17 → 區塊 L23 → 卡片 L33，
    // 彩度沿用深調 Hero（灰階主色由 deepSat 守住不強加彩度）；Light 維持淺調階梯。
    // 明暗兩端同一套色相骨架：
    // Dark 階梯＝深調由深到浮（頁面 L17 → 區塊 L23 → 卡片 L33），彩度沿用深調 Hero；
    // Light 階梯＝淺調但色相要讀得出來。注意 HSL 陷阱：L≥94 時彩度貢獻趨近零，
    //   淺色端要「高明度＋高彩度」（頁面 L90 S30-70 → 區塊 L94 → 卡片 L97）才看得到色，
    //   不再是舊版彩度封頂 28 的近中性灰白；灰階主色兩端都維持中性、不強加彩度。
    var bgS = mode === "dark"
      ? deepSat(Math.max(heroHsl.s, brandHsl.s * .6),.9,22,52)
      : (brandHsl.s < 12 && heroHsl.s < 12
          ? clamp(Math.max(heroHsl.s, brandHsl.s),3,10)
          : clamp(Math.max(heroHsl.s, brandHsl.s * .75),30,70));
    // dark 卡底直接取角色色 surface＝單一真值，避免 --campaign-surface 與 --campaign-bg-card 分岔
    var surfaceTint = mode === "dark" ? surface : hslHex(heroHsl.h, Math.round(bgS * .8), 97);
    var sectionTint = mode === "dark"
      ? hslHex(heroHsl.h, bgS, 23)
      : hslHex(heroHsl.h, Math.round(bgS * .9), 94);
    var pageHex = mode === "dark"
      ? hslHex(heroHsl.h, bgS, 17)
      : hslHex(heroHsl.h, bgS, 90);
    var productAmount = mode === "dark" ? 58 : 72;
    return [
      {key:"page",label:"Page / 活動頁底色",token:"campaign/page-bg",hex:mapping.page === "page" ? pageHex : (mapping.page === "bridge" ? (env.bridgeHex || pageHex) : roleColor("page","surface")),usage:mapping.page === "bridge" ? "整頁最底層背景（銜接色＝跟所選 Hero 背景圖走）" : "整頁最底層背景"},
      {key:"hero",label:"Hero / 主視覺背景",token:"campaign/hero-bg",hex:hero,usage:"首屏主視覺底色"},
      {key:"section",label:"Section / 區塊背景",token:"campaign/section-bg",hex:mapping.section === "section" ? sectionTint : roleColor("section","surface"),usage:"活動內容分段底色"},
      {key:"card",label:"Card / 內容卡片",token:"campaign/card-bg",hex:mapping.card === "card" ? surfaceTint : roleColor("card","surface"),usage:"商品卡與資訊容器"},
      {key:"product",label:"Product / 商品展示底",token:"campaign/product-bg",hex:mapping.product === "product" ? mixHex(colors.accent,surface,productAmount) : roleColor("product","accent"),usage:"商品圖、賣點區塊襯底"}
    ].map(function(r){
      // 設計師手動指定色（2026-08-25 使用者需求）：選定主色盤後可逐角色微調；手動色優先於映射與銜接色
      var ov = (env.bgOverrides || {})[r.key];
      return ov ? Object.assign({}, r, { hex: ov, usage: r.usage + "（手動指定色）" }) : r;
    });
  }
  function profile(hsl){
    var hue = hsl.s < 5 ? "中性灰階" :
      hsl.h < 25 || hsl.h >= 345 ? "紅色系" :
      hsl.h < 55 ? "橙黃色系" :
      hsl.h < 85 ? "黃色系" :
      hsl.h < 165 ? "綠色系" :
      hsl.h < 205 ? "青綠色系" :
      hsl.h < 255 ? "藍色系" :
      hsl.h < 295 ? "紫色系" : "粉紫色系";
    var sat = hsl.s < 18 ? "低彩度" : hsl.s < 55 ? "中彩度" : "高彩度";
    var light = hsl.l < 32 ? "低明度" : hsl.l < 68 ? "中明度" : "高明度";
    return hue + " / " + sat + " / " + light + "（H " + Math.round(hsl.h) + " S " + Math.round(hsl.s) + " L " + Math.round(hsl.l) + "）";
  }
  function suggestFamily(hsl,strategy){
    if(hsl.s < 8) return "mono";
    if(strategy === "premium" && hsl.h >= 25 && hsl.h < 65) return "gold-bronze";
    if(hsl.h >= 325 || hsl.h < 20) return "pink-plum";
    if(hsl.h >= 20 && hsl.h < 70) return "gold-bronze";
    if(hsl.h >= 75 && hsl.h < 170) return "green-sage";
    if(hsl.h >= 170 && hsl.h < 255) return "blue-calm";
    return "mono";
  }
  function makePalette(env){
    var rgb = hexToRgb(env.brandHex) || {r:47,g:104,b:216};
    var base = rgbToHsl(rgb);
    var strategy = env.strategy;
    var meta = strategyMeta[strategy];
    if (env.paletteSource === "brand" && env.brandExtensionRule) {
      return applyDesignerOverrides(applyThemeMode(resultFromPreset(
        generatedPalette(rgbToHex(rgb), env.brandExtensionRule, "品牌指定色｜" + harmonyLabels[env.brandExtensionRule], "保留指定主色，改變 CTA、背景、點綴色的延伸策略", "品牌識別優先；依活動情緒調整角色色", env.strategy),
        "brand-guided-" + env.brandExtensionRule, env
      ), env), env);
    }
    if (env.colorSourceMode === "mood" && env.paletteSource === "nippon") {
      var moodPreset = nipponPalettes[env.nipponId];
      if (moodPreset) return applyDesignerOverrides(applyThemeMode(resultFromPreset(moodPreset, "mood-" + env.activeMood + "-" + moodPreset.id, env), env), env);
    }
    if (env.paletteSource === "nippon" || env.paletteSource === "custom") {
      var preset = env.paletteSource === "custom"
        ? guidedPalette(rgbToHex(rgb), env.harmonyRule)
        : (nipponPalettes[env.nipponId] || nipponList[0]);
      return applyDesignerOverrides(applyThemeMode(resultFromPreset(preset, env.paletteSource === "custom" ? "custom-guided-" + env.harmonyRule : "nippon-" + preset.id, env), env), env);
    }
    var mood = moodAdjust[env.mood] || moodAdjust.bright;
    var sAdj = (Number(env.sat) || 0) + meta.s + mood.s;
    var lAdj = (Number(env.light) || 0) + meta.l + mood.l;
    var cAdj = (Number(env.contrast) || 0) + meta.c + mood.c;
    var h=base.h, s=clamp(base.s+sAdj,6,94), l=clamp(base.l+lAdj,14,92);
    var heroL = strategy === "trend" ? clamp(96 - cAdj*.18,86,98) : strategy === "premium" ? clamp(92 - cAdj*.24,80,96) : clamp(94 + lAdj*.08,84,98);
    var heroS = strategy === "morandi" ? clamp(s*.18,4,20) : strategy === "warm" ? clamp(s*.22,8,28) : clamp(s*.28,8,36);
    var headlineL = strategy === "trend" ? 7 : strategy === "premium" ? 16 : clamp(18 - cAdj*.08,7,28);
    var ctaH = strategy === "promo" ? 8 : strategy === "contrast" ? h+180 : strategy === "trend" ? h+95 : h;
    var accentH = strategy === "promo" ? 48 : strategy === "tech" ? h+34 : strategy === "premium" ? 42 : strategy === "warm" ? h+24 : h+155;
    var cta = hslHex(ctaH, clamp(s + 16 + cAdj*.25,24,96), clamp(45 + cAdj*.08,34,58));
    var accent = hslHex(accentH, clamp(s + 8,18,92), strategy === "premium" ? 64 : clamp(62 + cAdj*.08,48,76));
    var hero = hslHex(h, heroS, heroL);
    var surface = hslHex(h, clamp(heroS*.5,3,18), 99);
    var headline = hslHex(h, clamp(s*.35,8,42), headlineL);
    var price = strategy === "premium" ? hslHex(350,58,34) : strategy === "tech" ? "#D92D20" : "#EB0F29";
    var discount = price; /* 折數角色起步同 price（獨立角色；2026-09-27） */
    var brand = rgbToHex(rgb);
    var text = contrast("#344054",hero) >= 4.5 ? "#344054" : bestText(hero);
    return applyDesignerOverrides(applyThemeMode({
      base:base, strategy:strategy, meta:meta, family:suggestFamily(base,strategy),
      colors:{
        brand:brand,
        hero:hero,
        headline:headline,
        cta:cta,
        price:price,
        discount:discount,
        accent:accent,
        surface:surface,
        text:text,
        ctaText:bestText(cta),
        accentText:bestText(accent)
      }
    }, env), env);
  }

  // ── 整包推導入口（CMS 端用；工具端沿用細粒度函式＋自家 UI 狀態）──
  // 可讀性檢查（色彩列；主標對 Hero 門檻 3、其餘文字 4.5、價格對卡底 3——與工具頁檢查同一份數學）
  function readabilityChecks(colors, bgRoles, env) {
    var mapping = (env && env.moduleMapping) || moduleMappingDefaults;
    var heroModuleBg = (bgRoles.find(function(r){return r.key === "hero"}) || {}).hex || colors.hero;
    var cardModuleBg = (bgRoles.find(function(r){return r.key === "card"}) || {}).hex || colors.surface;
    var ctaModuleBg = mappedColor(colors, mapping, "cta", "cta");
    var priceModuleColor = mappedColor(colors, mapping, "price", "price");
    var titleColor = mappedColor(colors, mapping, "title", "headline");
    var subtitleColor = mappedColor(colors, mapping, "subtitle", "text");
    var eventLabelColor = mappedColor(colors, mapping, "eventLabel", "text");
    var eventDateColor = mappedColor(colors, mapping, "eventDate", "headline");
    /* hero 折扣數字與圓章（2026-09-27 使用者拍板「hero 價格與折數要跟主題走」）：折數多半壓在照片上＝跟標題族一樣對 titleBase 算、大字門檻 3；圓章字對圓章底 3 */
    /* 沒有 discount 欄的調色盤（舊呼叫端、測試夾具）＝退 price 再退 brand；mappedColor 找不到角色會回角色名字串、不是色碼，這裡自己守 */
    var discountColor = mappedColor(colors, mapping, "discount", "discount"); if (!hexToRgb(discountColor)) discountColor = colors.price || colors.brand;
    var discountBadgeBg = mappedColor(colors, mapping, "discountBadge", "accent"); if (!hexToRgb(discountBadgeBg)) discountBadgeBg = colors.accent || colors.brand;
    var discountBadgeTextColor = mappedColor(colors, mapping, "discountBadgeText", "text"); if (!hexToRgb(discountBadgeTextColor)) discountBadgeTextColor = colors.text || colors.headline;
    /* 標題族實際坐的底（2026-09-08 使用者裁「工具可讀性檢查對齊 CMS」＝60 號 §6.1 佇列項落地）：
       照片版面的標題壓在照片上、照片不跟草案換色——CMS 端（pipeline/lib/theme_draft checkThemeDraft）2026-09-04 起拿
       照片代表色（登記簿 bridgeColor／待審上傳量到的值）當底算，本引擎卻一直只看草案宣稱的 hero 底＝工具綠、CMS 紅
       （病例 run 150043：工具 13.8:1 綠、CMS 3.95:1 紅）。宿主把 env.heroSurface 傳進來（工具＝currentHeroSurface()）＝標題族四列改對它算；
       沒傳＝純色底版面、宣稱即真、照舊。門檻同批對齊 60 號 §1 擋級＝標題族一律 4.5（原主標 3）。 */
    var heroSurface = (env && typeof env.heroSurface === "string" && /^#[0-9a-fA-F]{6}$/.test(env.heroSurface)) ? env.heroSurface : null;
    var titleBase = heroSurface || heroModuleBg;
    var titleOn = heroSurface ? " / 照片底" : " / Hero";
    /* 文字坐在哪個底上＝逐款不同（2026-09-01 使用者裁決「保留設計師色權、機器多檢一格」）：
       有些版型的副標不是坐在 hero 底上，而是坐在一顆有自己顏色的膠囊上——設計師挑副標色時
       看的是 hero，膠囊上會不會看清楚沒人量。病例＝layout-001 的副標膠囊，設計師的淺灰副標
       壓在輔助色膠囊上只有 2.9:1。哪一款的哪段文字坐在什麼底上＝**真源在版式登記簿的
       textSurfaces 欄**（design-assets/layouts/manifest.json），本引擎不留版型名單（名單散落＝
       改一處漏一處，root CLAUDE.md 鐵律 4）。缺欄＝不檢＝零波及。 */
    var extra = [];
    var surf = (env && env.textSurfaces) || null;
    if (surf && surf.subtitle) {
      var fam = brandFamily(colors.brand, (env && env.themeMode) || "light");
      var surfHex = surf.subtitle === "brand-soft" ? fam.brandSoft
        : surf.subtitle === "brand-neon" ? fam.brandNeon
        : surf.subtitle === "brand" ? colors.brand : null;
      if (surfHex) extra.push(["副標題 / 膠囊底（這款版型專有）", contrast(subtitleColor, surfHex), 4.5]);
    }
    return [
      ["標題" + titleOn, contrast(titleColor, titleBase), 4.5],
      ["副標題" + titleOn, contrast(subtitleColor, titleBase), 4.5],
      ["活動時間標題" + titleOn, contrast(eventLabelColor, titleBase), 4.5],
      ["活動時間日期" + titleOn, contrast(eventDateColor, titleBase), 4.5],
      ["CTA / 文字", contrast(ctaModuleBg, bestText(ctaModuleBg)), 4.5],
      ["正文 / Hero", contrast(colors.text, heroModuleBg), 4.5],
      ["價格 / 卡底", contrast(priceModuleColor, cardModuleBg), 3],
      ["折扣數字" + titleOn, contrast(discountColor, titleBase), 3],
      ["折扣圓章 / 字對底", contrast(discountBadgeTextColor, discountBadgeBg), 3]
    ].concat(extra);
  }
  // 交付 CSS 變數字串（與工具頁 cssOutput 同一份組裝）
  // 第五參數 slots＝deriveTheme 內部傳入（含 slotOverrides 蓋值後的槽值）；外部直呼不帶 slots＝原行為（值相同）
  function cssVars(p, colors, bgRoles, env, slots) {
    var mapping = (env && env.moduleMapping) || moduleMappingDefaults;
    var heroModuleBg = (bgRoles.find(function(r){return r.key === "hero"}) || {}).hex || colors.hero;
    var ctaModuleBg = mappedColor(colors, mapping, "cta", "cta");
    var pick = function(key, fallback){ return (slots && slots[key] !== undefined) ? slots[key] : fallback; };
    var fam = slots ? { brandSoft: slots.brandSoft, brandNeon: slots.brandNeon } : brandFamily(colors.brand, p.themeMode || "light");
    return ':root {\n' +
      '  --campaign-theme-mode: ' + (p.themeMode || "light") + ';\n' +
      '  --campaign-brand: ' + pick("brand", colors.brand) + ';\n' +
      '  --campaign-brand-soft: ' + fam.brandSoft + ';\n' +
      '  --campaign-brand-neon: ' + fam.brandNeon + ';\n' +
      '  --campaign-hero-bg: ' + pick("hero", heroModuleBg) + ';\n' +
      '  --campaign-headline: ' + colors.headline + ';\n' +
      '  --campaign-title: ' + pick("title", mappedColor(colors, mapping, "title", "headline")) + ';\n' +
      '  --campaign-subtitle: ' + pick("subtitle", mappedColor(colors, mapping, "subtitle", "text")) + ';\n' +
      '  --campaign-event-label: ' + pick("eventLabel", mappedColor(colors, mapping, "eventLabel", "text")) + ';\n' +
      '  --campaign-event-date: ' + pick("eventDate", mappedColor(colors, mapping, "eventDate", "headline")) + ';\n' +
      '  --campaign-cta-bg: ' + pick("ctaBg", ctaModuleBg) + ';\n' +
      '  --campaign-cta-text: ' + pick("ctaText", bestText(ctaModuleBg)) + ';\n' +
      '  --campaign-price: ' + pick("price", mappedColor(colors, mapping, "price", "price")) + ';\n' +
      '  --campaign-discount: ' + pick("discount", mappedColor(colors, mapping, "discount", "discount")) + ';\n' +
      '  --campaign-discount-badge: ' + pick("discountBadge", mappedColor(colors, mapping, "discountBadge", "accent")) + ';\n' +
      '  --campaign-discount-badge-text: ' + pick("discountBadgeText", mappedColor(colors, mapping, "discountBadgeText", "text")) + ';\n' +
      '  --campaign-accent: ' + pick("accent", mappedColor(colors, mapping, "eyebrow", "accent")) + ';\n' +
      '  --campaign-card-badge: ' + pick("cardBadge", mappedColor(colors, mapping, "cardBadge", "accent")) + ';\n' +
      '  --campaign-title-badge: ' + pick("titleBadge", mappedColor(colors, mapping, "titleBadge", "accent")) + ';\n' +
      '  --campaign-lattice-line: ' + pick("latticeLine", mappedColor(colors, mapping, "latticeLine", "accent")) + ';\n' +
      '  --campaign-surface: ' + colors.surface + ';\n' +
      '  --campaign-text: ' + colors.text + ';\n' +
      bgRoles.map(function(r){return '  --campaign-bg-' + r.key + ': ' + r.hex + ';'}).join('\n') + '\n' +
      '}';
  }
  // 預設環境：CMS「調色盤選主色→整組推導」的最小輸入（主色＋明暗）；其餘旋鈕照表填
  function defaultEnv(brandHex, themeMode) {
    return { brandHex: brandHex || "#2F68D8", strategy: "tech", paletteSource: "custom",
      harmonyRule: "analogous", nipponId: null, colorSourceMode: "custom", brandExtensionRule: null,
      activeMood: "tech", mood: "bright", sat: 0, light: 0, contrast: 0,
      themeMode: themeMode || "light", colorOverrides: {}, moduleMapping: Object.assign({}, moduleMappingDefaults),
      bgOverrides: {}, bridgeHex: null, slotOverrides: {} };
  }
  // 一氣呵成：env →（配色方案、五背景階、15 槽、檢查、qaStatus、CSS 變數）
  function deriveTheme(env) {
    env = Object.assign(defaultEnv(env && env.brandHex, env && env.themeMode), env || {});
    var p = makePalette(env);
    var colors = p.colors;
    var bgRoles = backgroundPalette(colors, env);
    var mapping = env.moduleMapping || moduleMappingDefaults;
    var checks = readabilityChecks(colors, bgRoles, env);
    var byKey = {}; bgRoles.forEach(function(r){ byKey[r.key] = r.hex; });
    var ctaBg = mappedColor(colors, mapping, "cta", "cta");
    var slots = {
      page: byKey.page, hero: byKey.hero, section: byKey.section, card: byKey.card, product: byKey.product,
      title: mappedColor(colors, mapping, "title", "headline"),
      subtitle: mappedColor(colors, mapping, "subtitle", "text"),
      eventLabel: mappedColor(colors, mapping, "eventLabel", "text"),
      eventDate: mappedColor(colors, mapping, "eventDate", "headline"),
      accent: mappedColor(colors, mapping, "eyebrow", "accent"),
      ctaBg: ctaBg, ctaText: bestText(ctaBg),
      price: mappedColor(colors, mapping, "price", "price"),
      discount: mappedColor(colors, mapping, "discount", "discount"),
      discountBadge: mappedColor(colors, mapping, "discountBadge", "accent"),
      discountBadgeText: mappedColor(colors, mapping, "discountBadgeText", "text"),
      cardBadge: mappedColor(colors, mapping, "cardBadge", "accent"),
      titleBadge: mappedColor(colors, mapping, "titleBadge", "accent"),
      latticeLine: mappedColor(colors, mapping, "latticeLine", "accent")
    };
    // 家族三軌（2026-08-26 兩線協定）：brand＝直通、soft/neon＝brandFamily 推導
    var fam = brandFamily(colors.brand, p.themeMode || "light");
    slots.brand = colors.brand;
    slots.brandSoft = fam.brandSoft;
    slots.brandNeon = fam.brandNeon;
    // slotOverrides＝18 槽鍵逐槽蓋值（壞值忽略；恆定槽 price/card/product 的把關依契約＝宿主閘；cssVars 的 --campaign-bg-* 走 bgRoles 原值、bg 槽覆寫由宿主自行組裝）
    var so = env.slotOverrides || {};
    Object.keys(so).forEach(function(key){
      if (!(key in slots)) return;
      var oRgb = hexToRgb(so[key]);
      if (!oRgb) return;
      slots[key] = rgbToHex(oRgb);
    });
    if (so.ctaBg && hexToRgb(so.ctaBg)) slots.ctaText = bestText(slots.ctaBg);
    return { themeMode: p.themeMode || "light", palette: p, colors: colors, bgRoles: bgRoles,
      slots: slots, checks: checks,
      qaStatus: checks.every(function(c){ return c[1] >= c[2]; }) ? "candidate-pass" : "needs-review",
      cssVars: cssVars(p, colors, bgRoles, env, slots) };
  }

  return {
    version: "1.3.0", // 2026-09-27：discount 角色＋折扣數字／圓章底／圓章字三列映射＋兩列可讀性檢查＋三支 --campaign-discount* 變數（使用者拍板推翻「價格顏色恆定」，hero 價格與折數各自可設；裁決牆 qa/hero-price-discount-color-wall-2026-09-27）；1.2.0 2026-09-08：readabilityChecks 吃 env.heroSurface＋標題族門檻 4.5（對齊 CMS；60 號 §6.1 佇列項落地）
    clamp: clamp, mod: mod, hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb, hslHex: hslHex, mixHex: mixHex, contrast: contrast, bestText: bestText,
    brandFamily: brandFamily,
    colorDistance: colorDistance, tuneHex: tuneHex, deepSat: deepSat,
    deepenForContrast: deepenForContrast, liftForSeparation: liftForSeparation,
    profile: profile, suggestFamily: suggestFamily,
    strategyMeta: strategyMeta, moodAdjust: moodAdjust, harmonyLabels: harmonyLabels,
    jpColors: jpColors, toneColor: toneColor, nipponPreset: nipponPreset,
    nipponList: nipponList, nipponPalettes: nipponPalettes,
    moduleMappingDefaults: moduleMappingDefaults, moduleComponents: moduleComponents,
    nearestNipponPalette: nearestNipponPalette, guidedPalette: guidedPalette,
    generatedPalette: generatedPalette, resultFromPreset: resultFromPreset,
    applyPaletteTuning: applyPaletteTuning, applyThemeMode: applyThemeMode,
    applyDesignerOverrides: applyDesignerOverrides, mappedColor: mappedColor,
    makePalette: makePalette, backgroundPalette: backgroundPalette,
    readabilityChecks: readabilityChecks, cssVars: cssVars,
    defaultEnv: defaultEnv, deriveTheme: deriveTheme
  };
});
