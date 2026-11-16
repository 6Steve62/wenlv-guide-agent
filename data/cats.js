/* =============================================================================
 * 视觉品类字典 · 跨城市复用
 * -----------------------------------------------------------------------------
 * 这一份不绑定任何城市：它定义「一类地方长什么样、用什么颜色」。
 *
 * 为什么按品类配图，而不是按景点配图：
 *   1. 45 处景点各自配一张实景照片，会引入第三方版权；本作品的核心卖点正是
 *      「零外部依赖、坐标自建、不接地图 SDK」，素材来源必须一样干净。
 *   2. 写实照片一旦与实景不符就是误导。示意图只承担「视觉锚点」，不声称是
 *      某处实景，因此不存在「画得不像」的问题。
 *   3. 同类共图 → 风格必然统一，不会东一张西一张。
 *   4. 换城市时插画直接复用，新数据包只要给每处景点标一个 cat 即可。
 *
 * 每类提供四个值：
 *   label  中文品类名（显示在攻略卡与结果页上）
 *   tint   强调色（文字）
 *   wash   浅底色（标签底、色带）
 *   line   描边色
 *   art    场景插画（内联 SVG 字符串，视框固定 1200×450，三层景深）
 *
 * 插画全部为自绘矢量，不含任何第三方素材，可随代码自由分发。
 * ========================================================================== */

window.CAT_VISUALS = (function () {

  function scene(body) {
    return '<svg class="catart" viewBox="0 0 1200 450" preserveAspectRatio="xMidYMid slice" ' +
      'xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /* 每幅插画共用同一套语法：天空 → 远景山脊 → 中景主体 → 近景地面，
     所以不论哪一类，摆在一起都像同一本画册里的页。 */

  var ART = {

    river:
      '<rect width="1200" height="450" fill="#FBEED7"/>' +
      '<circle cx="884" cy="146" r="64" fill="#EFA43C"/>' +
      '<path d="M0 300 L118 234 L214 272 L336 212 L466 268 L596 230 L756 278 L898 238 L1042 276 L1200 228 L1200 302 L0 302 Z" fill="#E3C69B"/>' +
      '<path d="M0 302 C 200 288 340 328 560 314 C 780 300 940 338 1200 318 L1200 356 L0 356 Z" fill="#C9A76E"/>' +
      '<path d="M0 356 C 180 336 320 366 520 352 C 720 338 900 372 1200 348 L1200 450 L0 450 Z" fill="#EEDCBB"/>' +
      '<path d="M0 404 C 220 388 400 416 620 402 C 840 388 1020 418 1200 400 L1200 450 L0 450 Z" fill="#E1CAA2"/>' +
      '<g fill="none" stroke="#8A6A3B" stroke-width="3" stroke-linecap="round">' +
        '<path d="M772 92 q11 -10 22 0 q11 -10 22 0"/>' +
        '<path d="M846 128 q9 -8 18 0 q9 -8 18 0"/>' +
      '</g>',

    lake:
      '<rect width="1200" height="450" fill="#E9F1EC"/>' +
      '<path d="M0 262 L150 198 L260 238 L400 190 L530 234 L670 200 L820 242 L970 204 L1090 240 L1200 208 L1200 266 L0 266 Z" fill="#BCD3CA"/>' +
      '<rect y="262" width="1200" height="188" fill="#CBE4DA"/>' +
      '<rect y="262" width="1200" height="30" fill="#B2D3C7"/>' +
      '<g fill="#A9CCC0">' +
        '<ellipse cx="250" cy="302" rx="88" ry="7"/>' +
        '<ellipse cx="648" cy="288" rx="56" ry="6"/>' +
        '<ellipse cx="966" cy="314" rx="104" ry="8"/>' +
        '<ellipse cx="430" cy="354" rx="120" ry="9"/>' +
        '<ellipse cx="886" cy="388" rx="140" ry="10"/>' +
      '</g>' +
      '<path d="M470 344 h100 l-17 16 h-66 Z" fill="#5C4A38"/>' +
      '<path d="M510 344 v-34 l30 34 Z" fill="#F4F1E9"/>' +
      '<path d="M0 404 C 200 388 360 418 560 406 C 760 394 980 420 1200 402 L1200 450 L0 450 Z" fill="#AFC6B4"/>' +
      '<g fill="none" stroke="#6E9A7C" stroke-width="4" stroke-linecap="round">' +
        '<path d="M60 450 C 54 408 64 386 58 356"/>' +
        '<path d="M96 450 C 92 412 100 396 94 370"/>' +
        '<path d="M132 450 C 128 416 136 400 130 378"/>' +
        '<path d="M168 450 C 164 418 172 404 166 384"/>' +
        '<path d="M1064 450 C 1058 412 1068 392 1062 366"/>' +
        '<path d="M1100 450 C 1096 416 1104 398 1098 376"/>' +
        '<path d="M1136 450 C 1132 420 1140 404 1134 386"/>' +
      '</g>' +
      '<g fill="#93B79E">' +
        '<ellipse cx="58" cy="350" rx="7" ry="15"/><ellipse cx="94" cy="364" rx="6" ry="13"/>' +
        '<ellipse cx="130" cy="372" rx="6" ry="12"/><ellipse cx="166" cy="378" rx="5" ry="11"/>' +
        '<ellipse cx="1062" cy="360" rx="7" ry="15"/><ellipse cx="1098" cy="370" rx="6" ry="13"/>' +
        '<ellipse cx="1134" cy="380" rx="5" ry="11"/>' +
      '</g>',

    mountain:
      '<rect width="1200" height="450" fill="#E9EFF5"/>' +
      '<circle cx="236" cy="122" r="46" fill="#F2DDAF"/>' +
      '<g fill="#FFFFFF">' +
        '<rect x="742" y="84" width="152" height="22" rx="11"/>' +
        '<rect x="826" y="116" width="94" height="18" rx="9"/>' +
      '</g>' +
      '<path d="M0 320 L170 214 L300 268 L430 182 L560 258 L700 200 L860 272 L1000 214 L1130 268 L1200 228 L1200 330 L0 330 Z" fill="#B7C6D3"/>' +
      '<g fill="#FFFFFF" opacity="0.85">' +
        '<path d="M170 214 L196 238 L144 238 Z"/>' +
        '<path d="M430 182 L458 208 L402 208 Z"/>' +
        '<path d="M700 200 L726 224 L674 224 Z"/>' +
      '</g>' +
      '<path d="M0 356 L140 268 L262 316 L392 244 L520 312 L648 262 L790 326 L930 268 L1060 318 L1200 276 L1200 366 L0 366 Z" fill="#93A6B8"/>' +
      '<path d="M0 398 L120 330 L250 374 L380 314 L520 372 L660 322 L800 380 L950 330 L1090 378 L1200 342 L1200 450 L0 450 Z" fill="#6F8496"/>',

    relic:
      '<rect width="1200" height="450" fill="#F5E9DA"/>' +
      '<path d="M0 130 C 180 96 300 132 430 108 C 560 84 660 118 790 98 C 920 78 1040 112 1200 92 L1200 450 L0 450 Z" fill="#E2CCB0"/>' +
      '<path d="M0 210 C 200 186 320 216 470 194 C 620 172 720 204 870 184 C 1020 164 1100 194 1200 178 L1200 450 L0 450 Z" fill="#D2B896"/>' +
      '<path d="M0 300 C 220 278 380 310 560 292 C 740 274 900 306 1200 284 L1200 450 L0 450 Z" fill="#C2A681"/>' +
      '<path d="M0 356 C 240 340 420 366 640 352 C 860 338 1040 362 1200 348 L1200 394 L0 394 Z" fill="#B0906C"/>' +
      '<g fill="none" stroke="#6B4C33" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="330" cy="212" r="34"/>' +
        '<path d="M330 172 v-24 M330 252 v24 M290 212 h-24 M370 212 h24"/>' +
        '<path d="M302 184 l-17 -17 M358 184 l17 -17 M302 240 l-17 17 M358 240 l17 17"/>' +
        '<path d="M600 188 v56 M600 202 l-26 -19 M600 202 l26 -19 M600 240 l-21 29 M600 240 l21 29"/>' +
        '<path d="M786 194 q30 -16 46 3 q26 -11 38 6 l-5 42 l-19 -7 l-3 -23 l-57 -2 Z"/>' +
        '<circle cx="938" cy="222" r="10"/>' +
      '</g>' +
      '<g fill="none" stroke="#8A6A4A" stroke-width="3" stroke-linecap="round">' +
        '<path d="M474 152 v20 M1006 140 v18 M540 262 v14"/>' +
      '</g>' +
      '<path d="M0 404 C 220 386 420 414 640 400 C 860 386 1020 416 1200 398 L1200 450 L0 450 Z" fill="#9C7B5C"/>',

    pagoda:
      '<rect width="1200" height="450" fill="#EFEFE9"/>' +
      '<circle cx="884" cy="118" r="52" fill="#F2E2B6"/>' +
      '<path d="M0 342 C 220 322 420 354 640 338 C 860 322 1020 352 1200 334 L1200 450 L0 450 Z" fill="#C9C4B6"/>' +
      '<path d="M600 106 v-24" stroke="#6B5C49" stroke-width="4"/>' +
      '<circle cx="600" cy="78" r="7" fill="#6B5C49"/>' +
      '<path d="M584 122 H616 L610 108 H590 Z" fill="#7A6A55"/>' +
      '<rect x="590" y="122" width="20" height="34" fill="#8A7860"/>' +
      '<path d="M576 174 H624 L616 162 H584 Z" fill="#7A6A55"/>' +
      '<rect x="586" y="174" width="28" height="34" fill="#8A7860"/>' +
      '<path d="M566 228 H634 L624 216 H576 Z" fill="#7A6A55"/>' +
      '<rect x="582" y="228" width="36" height="34" fill="#8A7860"/>' +
      '<path d="M554 282 H646 L634 270 H566 Z" fill="#7A6A55"/>' +
      '<rect x="576" y="282" width="48" height="34" fill="#8A7860"/>' +
      '<path d="M540 336 H660 L646 324 H552 Z" fill="#7A6A55"/>' +
      '<rect x="570" y="336" width="60" height="8" fill="#8A7860"/>' +
      '<rect x="532" y="344" width="136" height="14" rx="3" fill="#B8B2A2"/>' +
      '<rect x="596" y="136" width="8" height="14" fill="#5F5344"/>' +
      '<rect x="594" y="188" width="10" height="14" fill="#5F5344"/>' +
      '<g fill="#6E8A66">' +
        '<circle cx="376" cy="330" r="42"/><circle cx="428" cy="346" r="28"/>' +
      '</g>' +
      '<g fill="#7C9A72">' +
        '<circle cx="812" cy="336" r="34"/><circle cx="856" cy="350" r="24"/>' +
      '</g>' +
      '<rect x="372" y="356" width="8" height="22" fill="#6B5A46"/>' +
      '<rect x="808" y="360" width="7" height="20" fill="#6B5A46"/>',

    sier:
      '<rect width="1200" height="450" fill="#F4E5D1"/>' +
      '<circle cx="812" cy="176" r="50" fill="#E9A85A"/>' +
      '<path d="M0 296 L160 236 L300 280 L440 226 L580 276 L720 232 L880 284 L1020 238 L1200 282 L1200 306 L0 306 Z" fill="#C9B49B"/>' +
      '<path d="M0 306 C 200 292 360 320 580 306 C 800 292 980 324 1200 304 L1200 450 L0 450 Z" fill="#E6D6BA"/>' +
      '<path d="M862 330 H964 L934 252 H892 Z" fill="#CDB18E"/>' +
      '<ellipse cx="582" cy="360" rx="122" ry="16" fill="#D9C4A2"/>' +
      '<path d="M500 352 L546 190 H616 L662 352 Z" fill="#BE9A70"/>' +
      '<path d="M500 352 L546 190 H580 L572 352 Z" fill="#C9A87E"/>' +
      '<path d="M0 412 C 220 396 420 422 640 408 C 860 394 1020 422 1200 406 L1200 450 L0 450 Z" fill="#DCC8A6"/>' +
      '<g fill="none" stroke="#B29064" stroke-width="3" stroke-linecap="round">' +
        '<path d="M188 424 C 184 404 192 396 188 384"/>' +
        '<path d="M214 428 C 212 410 220 402 216 392"/>' +
        '<path d="M1030 420 C 1026 402 1034 394 1030 382"/>' +
        '<path d="M1056 424 C 1054 408 1062 400 1058 390"/>' +
      '</g>',

    winery:
      '<rect width="1200" height="450" fill="#EFF3E9"/>' +
      '<path d="M0 250 L150 190 L280 232 L420 176 L560 226 L700 184 L860 236 L1000 188 L1120 230 L1200 200 L1200 258 L0 258 Z" fill="#AFBCA0"/>' +
      '<rect y="258" width="1200" height="192" fill="#E4EADB"/>' +
      '<g stroke="#93A87C" stroke-width="9" stroke-linecap="round" fill="none">' +
        '<path d="M76 450 L600 266"/>' +
        '<path d="M248 450 L600 266"/>' +
        '<path d="M424 450 L600 266"/>' +
        '<path d="M776 450 L600 266"/>' +
        '<path d="M952 450 L600 266"/>' +
        '<path d="M1124 450 L600 266"/>' +
      '</g>' +
      '<g stroke="#A9BC94" stroke-width="4" stroke-linecap="round" fill="none">' +
        '<path d="M118 450 L600 274"/>' +
        '<path d="M336 450 L600 274"/>' +
        '<path d="M664 450 L600 274"/>' +
        '<path d="M1082 450 L600 274"/>' +
      '</g>' +
      '<path d="M168 200 H292 L278 186 H182 Z" fill="#ABA392"/>' +
      '<rect x="180" y="200" width="120" height="58" fill="#CFC7B5"/>' +
      '<rect x="206" y="218" width="20" height="28" fill="#8E887C"/>' +
      '<rect x="254" y="218" width="20" height="28" fill="#8E887C"/>' +
      '<g fill="#6E4B7A">' +
        '<circle cx="150" cy="392" r="14"/><circle cx="166" cy="404" r="14"/>' +
        '<circle cx="134" cy="404" r="14"/><circle cx="152" cy="416" r="12"/>' +
      '</g>' +
      '<path d="M152 368 v16" stroke="#4F6B3A" stroke-width="4"/>',

    museum:
      '<rect width="1200" height="450" fill="#EDEDEA"/>' +
      '<path d="M0 300 C 200 288 400 312 620 300 C 840 288 1020 312 1200 298 L1200 450 L0 450 Z" fill="#E4E1DA"/>' +
      '<path d="M300 236 H900 L858 186 H342 Z" fill="#A9A497"/>' +
      '<path d="M342 186 H858 L850 176 H350 Z" fill="#8E887C"/>' +
      '<rect x="360" y="236" width="480" height="112" fill="#BEB8AC"/>' +
      '<rect x="360" y="252" width="480" height="96" fill="#9E998C"/>' +
      '<rect x="580" y="252" width="72" height="96" fill="#7E7A6E"/>' +
      '<rect x="588" y="238" width="64" height="14" rx="2" fill="#A32D2D"/>' +
      '<g fill="#DAD6CC">' +
        '<rect x="376" y="246" width="26" height="102"/>' +
        '<rect x="456" y="246" width="26" height="102"/>' +
        '<rect x="536" y="246" width="26" height="102"/>' +
        '<rect x="638" y="246" width="26" height="102"/>' +
        '<rect x="718" y="246" width="26" height="102"/>' +
        '<rect x="798" y="246" width="26" height="102"/>' +
      '</g>' +
      '<rect x="330" y="348" width="540" height="10" fill="#D0CCC2"/>' +
      '<rect x="306" y="358" width="588" height="14" rx="3" fill="#DAD6CC"/>' +
      '<g fill="#7C9166">' +
        '<circle cx="188" cy="300" r="36"/><circle cx="232" cy="316" r="24"/>' +
        '<circle cx="1016" cy="306" r="32"/><circle cx="1058" cy="320" r="22"/>' +
      '</g>' +
      '<rect x="184" y="326" width="8" height="26" fill="#6B5A46"/>' +
      '<rect x="1012" y="330" width="7" height="24" fill="#6B5A46"/>',

    night:
      '<rect width="1200" height="450" fill="#31404E"/>' +
      '<g fill="#C9D6E0">' +
        '<circle cx="184" cy="72" r="3"/><circle cx="424" cy="46" r="2.5"/><circle cx="644" cy="38" r="2.5"/>' +
        '<circle cx="906" cy="62" r="3"/><circle cx="1064" cy="98" r="2.5"/><circle cx="300" cy="112" r="2.5"/>' +
      '</g>' +
      '<circle cx="986" cy="102" r="40" fill="#F0E3C0"/>' +
      '<path d="M0 268 L170 210 L320 254 L470 198 L620 250 L770 206 L930 258 L1080 212 L1200 252 L1200 282 L0 282 Z" fill="#3E4E5D"/>' +
      '<rect y="282" width="1200" height="168" fill="#26313C"/>' +
      '<path d="M180 300 H360 L344 328 H196 Z" fill="#B4433E"/>' +
      '<rect x="196" y="328" width="148" height="62" fill="#6B5A46"/>' +
      '<path d="M470 300 H650 L634 328 H486 Z" fill="#C98A3A"/>' +
      '<rect x="486" y="328" width="148" height="62" fill="#6B5A46"/>' +
      '<path d="M760 300 H940 L924 328 H776 Z" fill="#4E7A6A"/>' +
      '<rect x="776" y="328" width="148" height="62" fill="#6B5A46"/>' +
      '<path d="M60 116 C 320 172 620 172 900 118" fill="none" stroke="#7A6A55" stroke-width="2"/>' +
      '<g fill="#EF9F27">' +
        '<circle cx="152" cy="134" r="11"/><circle cx="256" cy="152" r="11"/><circle cx="360" cy="162" r="11"/>' +
        '<circle cx="466" cy="166" r="11"/><circle cx="572" cy="166" r="11"/><circle cx="678" cy="162" r="11"/>' +
        '<circle cx="784" cy="152" r="11"/><circle cx="876" cy="136" r="11"/>' +
      '</g>' +
      '<path d="M0 402 C 220 390 420 414 640 402 C 860 390 1020 412 1200 400 L1200 450 L0 450 Z" fill="#303C48"/>',

    art:
      '<rect width="1200" height="450" fill="#F1EEE9"/>' +
      '<path d="M0 306 C 200 294 400 316 620 304 C 840 292 1020 314 1200 302 L1200 450 L0 450 Z" fill="#DCD8CF"/>' +
      '<rect x="300" y="94" width="34" height="108" fill="#ADA79B"/>' +
      '<rect x="294" y="86" width="46" height="12" fill="#979187"/>' +
      '<path d="M220 200 H340 L340 164 H260 Z" fill="#A29B8E"/>' +
      '<path d="M340 200 H460 L460 164 H380 Z" fill="#A29B8E"/>' +
      '<path d="M460 200 H580 L580 164 H500 Z" fill="#A29B8E"/>' +
      '<rect x="220" y="200" width="360" height="116" fill="#BBB5A9"/>' +
      '<g fill="#8E887C">' +
        '<rect x="244" y="222" width="44" height="52"/><rect x="312" y="222" width="44" height="52"/>' +
        '<rect x="380" y="222" width="44" height="52"/><rect x="448" y="222" width="44" height="52"/>' +
        '<rect x="516" y="222" width="44" height="52"/>' +
      '</g>' +
      '<rect x="700" y="220" width="300" height="96" fill="#F5F2EC"/>' +
      '<rect x="722" y="240" width="62" height="52" fill="#D85A30"/>' +
      '<rect x="800" y="240" width="62" height="52" fill="#378ADD"/>' +
      '<rect x="878" y="240" width="62" height="52" fill="#EF9F27"/>' +
      '<rect x="1006" y="292" width="96" height="24" rx="3" fill="#B5AFA3"/>' +
      '<path d="M1054 292 L1032 240 L1076 240 Z" fill="#6E8A66"/>' +
      '<circle cx="1054" cy="226" r="15" fill="#D85A30"/>' +
      '<path d="M0 404 C 220 392 420 414 640 402 C 860 390 1020 412 1200 400 L1200 450 L0 450 Z" fill="#CFCBC2"/>',

    bloom:
      '<rect width="1200" height="450" fill="#F7EEF2"/>' +
      '<path d="M0 240 L160 186 L300 226 L440 174 L600 222 L760 180 L920 228 L1080 184 L1200 220 L1200 250 L0 250 Z" fill="#C6CFC0"/>' +
      '<path d="M0 250 C 260 240 460 260 700 250 C 920 240 1060 258 1200 250 L1200 282 L0 282 Z" fill="#E9B8CB"/>' +
      '<path d="M0 282 C 260 272 460 292 700 282 C 920 272 1060 290 1200 282 L1200 314 L0 314 Z" fill="#F2D6E1"/>' +
      '<path d="M0 314 C 260 304 460 324 700 314 C 920 304 1060 322 1200 314 L1200 346 L0 346 Z" fill="#C9DEC0"/>' +
      '<path d="M0 346 C 260 336 460 356 700 346 C 920 336 1060 354 1200 346 L1200 378 L0 378 Z" fill="#E4B9A6"/>' +
      '<path d="M0 378 C 260 368 460 388 700 378 C 920 368 1060 386 1200 378 L1200 414 L0 414 Z" fill="#F0D8C0"/>' +
      '<path d="M0 414 C 260 404 460 424 700 414 C 920 404 1060 422 1200 414 L1200 450 L0 450 Z" fill="#CFE0C6"/>' +
      '<path d="M556 450 L600 258 L648 450 Z" fill="#F7F1E8"/>' +
      '<g fill="#7C9166">' +
        '<circle cx="212" cy="214" r="34"/><circle cx="250" cy="226" r="24"/>' +
        '<circle cx="978" cy="218" r="30"/><circle cx="1016" cy="230" r="21"/>' +
      '</g>' +
      '<rect x="208" y="240" width="8" height="24" fill="#6B5A46"/>' +
      '<rect x="974" y="242" width="7" height="22" fill="#6B5A46"/>'
  };

  var CATS = {
    river:    { label: '黄河长河', tint: '#854F0B', wash: '#FAEEDA', line: '#FAC775', art: scene(ART.river) },
    lake:     { label: '湖泽湿地', tint: '#0F6E56', wash: '#E1F5EE', line: '#5DCAA5', art: scene(ART.lake) },
    mountain: { label: '贺兰山岳', tint: '#185FA5', wash: '#E6F1FB', line: '#85B7EB', art: scene(ART.mountain) },
    relic:    { label: '史前遗踪', tint: '#444441', wash: '#F1EFE8', line: '#B4B2A9', art: scene(ART.relic) },
    pagoda:   { label: '古塔寺观', tint: '#534AB7', wash: '#EEEDFE', line: '#AFA9EC', art: scene(ART.pagoda) },
    sier:     { label: '西夏古堡', tint: '#633806', wash: '#FAEEDA', line: '#FAC775', art: scene(ART.sier) },
    winery:   { label: '东麓酒庄', tint: '#3B6D11', wash: '#EAF3DE', line: '#C0DD97', art: scene(ART.winery) },
    museum:   { label: '馆藏研学', tint: '#A32D2D', wash: '#FCEBEB', line: '#F09595', art: scene(ART.museum) },
    night:    { label: '夜市演艺', tint: '#042C53', wash: '#E6F1FB', line: '#B5D4F4', art: scene(ART.night) },
    art:      { label: '艺术园区', tint: '#993C1D', wash: '#FAECE7', line: '#F0997B', art: scene(ART.art) },
    bloom:    { label: '花海园林', tint: '#72243E', wash: '#FBEAF0', line: '#ED93B1', art: scene(ART.bloom) }
  };

  /* 数据包里万一出现没标 cat 的点位，也不至于开天窗：给一条通用地平线。 */
  CATS._default = {
    label: '未分类', tint: '#444441', wash: '#F1EFE8', line: '#B4B2A9',
    art: scene(
      '<rect width="1200" height="450" fill="#F1EFE8"/>' +
      '<path d="M0 300 L200 226 L380 276 L560 216 L760 274 L960 224 L1200 288 L1200 320 L0 320 Z" fill="#D3D1C7"/>' +
      '<path d="M0 320 C 240 306 460 332 700 318 C 920 306 1060 328 1200 316 L1200 450 L0 450 Z" fill="#E4E2DA"/>'
    )
  };

  return CATS;
})();

/* 取某处景点的视觉品类；缺失或写错一律回落到通用款，不抛错。 */
window.catVisual = function (spot) {
  var id = spot && spot.cat;
  return (window.CAT_VISUALS && window.CAT_VISUALS[id]) || window.CAT_VISUALS._default;
};
