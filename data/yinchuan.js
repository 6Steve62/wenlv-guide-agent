/* =============================================================================
 * 数据包 · 银川市全域
 * -----------------------------------------------------------------------------
 * 这是「文旅导览智能体」唯一的城市相关文件。引擎（js/engine.js）不含任何
 * 银川专属的硬编码地理知识——车程、片区、就近餐饮全部由本文件的坐标推导。
 * 想支持新城市，复制本文件改名（如 wuzhong.js），改 window.CITY_DATA 的键名
 * 与数据内容，在 index.html 里换一行 <script src> 即可，引擎零改动。
 *
 * 字段说明
 *   district   所属区县（市）。直接采用政府名录口径，不再人工划片区
 *   lng / lat  GCJ-02 近似坐标。按景区所在乡镇/城区估算，用于计算车程与就近
 *              检索；若要精确到门牌，建议接入地图开放平台的 POI 检索获取
 *   urban      是否位于市区三区（兴庆/金凤/西夏）建成区内。影响市区拥堵时速
 *   roadKph    非市区路段的典型时速：山路 44-48，乡道 30-35，干道 50-58
 *   stay       建议游览时长（分钟）
 *   slot       'day' 白天 | 'night' 仅夜游 | 'both' 皆可
 *   tags       偏好标签，用于和用户勾选的兴趣做匹配打分
 *   cat        视觉品类。取值见 data/cats.js 的品类字典——决定攻略卡题图与
 *              结果页配色。这是跨城市复用的字段：新城市只要给每处景点标上
 *              cat，整套插画与配色直接可用，无需新画素材
 *   free       免票政策（可选）。periods 逐段给「适用日期区间 + 星期几」，
 *              scope 写优惠对象、except 写除外情形。引擎只负责拼句与展示，
 *              不判断当前落在哪一段——引擎没有日期输入，也绝不据此改预算
 *              （人均门票仍按全价口径累加，由读者自己对照日期）
 *
 * 数据来源
 *   银川市国家 A 级旅游景区一览表（银川市人民政府 · 2023 年鉴）
 *   宁夏回族自治区国家 A 级旅游景区名录（自治区文化和旅游厅 · 2024-09）
 *   西夏陵免票政策：人民网宁夏频道 / 宁夏日报 2026-08 报道（分时段文化惠民）
 *   门票与开放时间为公开参考值，实际以景区当日公示为准
 * ========================================================================== */

window.CITY_DATA = window.CITY_DATA || {};

window.CITY_DATA.yinchuan = {
  id: 'yinchuan',
  name: '银川市',
  subtitle: '宁夏回族自治区首府 · 3 区 2 县 1 市',
  coordSystem: 'GCJ-02',

  /* 行程驻点：单基地模型的锚点，每天由此出发、回到此处 */
  base: {
    id: 'base', name: '银川市区（新华街商圈）',
    district: '兴庆区', lng: 106.2810, lat: 38.4700,
    urban: true, roadKph: 58
  },

  /* 区县展示名 */
  districts: {
    '兴庆区': '兴庆区 · 老城与黄河东岸',
    '金凤区': '金凤区 · 城市新区',
    '西夏区': '西夏区 · 贺兰山东麓',
    '永宁县': '永宁县 · 玉泉营与闽宁镇',
    '贺兰县': '贺兰县 · 贺兰山北段',
    '灵武市': '灵武市 · 黄河东岸与宁东'
  },

  attractions: [
    /* ============ 西夏区 · 贺兰山东麓 ============ */
    {
      id: 'yb', name: '镇北堡西部影城', district: '西夏区', level: '5A',
      cat: 'sier',
      lng: 105.9950, lat: 38.6350, urban: false, roadKph: 52,
      stay: 180, ticket: 76, open: '08:30-17:30', slot: 'day',
      tags: ['人文历史', '摄影出片', '亲子友好'],
      bg: '明清两代屯兵的土城堡，1993 年由作家张贤亮改造成影视基地，《大话西游》《红高粱》等百余部影视剧在此取景。',
      hl: '清城城墙与月亮门、至尊宝求婚同款机位、明城「老银川一条街」、可租戏服拍同款镜头。'
    },
    {
      id: 'xxl', name: '西夏陵', district: '西夏区', level: '4A',
      cat: 'sier',
      lng: 105.9880, lat: 38.4280, urban: false, roadKph: 52,
      stay: 150, ticket: 68, open: '08:00-17:00', slot: 'day',
      tags: ['人文历史', '摄影出片', '科普研学'],
      /* 免票政策：人民网宁夏频道 / 宁夏日报 2026-08 报道的分时段文化惠民口径。
         注意是两个时段、免票日不同——3月至10月仅周一，11月至次年2月才是周一、周三；
         界面把两段都摆出来，由读者按自己的日期对照（引擎没有日期输入）。 */
      free: {
        periods: [
          { range: '3月1日–10月31日', dows: [1] },
          { range: '11月1日–次年2月28日', dows: [1, 3] }
        ],
        scope: '对全国游客免首道门票',
        except: '法定节假日除外'
      },
      bg: '西夏王朝 9 座帝陵与 250 余座陪葬墓，坐落在贺兰山东麓，被誉为「东方金字塔」。',
      hl: '三号陵（泰陵）陵塔残迹、西夏陵博物馆、鎏金铜牛等镇馆文物、双陵骆驼。'
    },
    {
      id: 'xxfqy', name: '西夏风情园', district: '西夏区', level: '4A',
      cat: 'sier',
      lng: 106.1000, lat: 38.4780, urban: true, roadKph: 58,
      stay: 120, ticket: 66, open: '08:00-18:00', slot: 'day',
      tags: ['人文历史', '亲子友好', '轻松休闲'],
      bg: '西夏区北京西路旁的主题公园，用实景马战与民俗演艺还原党项人的日常与征战。',
      hl: '实景马战表演、擂台杂耍、陶艺与瓶绘手作、西夏广场对望的贺兰山天际线。'
    },
    {
      id: 'mp', name: '漫葡·看见贺兰演艺小镇', district: '西夏区', level: '4A',
      cat: 'night',
      lng: 106.0020, lat: 38.6320, urban: false, roadKph: 48,
      stay: 150, ticket: 158, open: '09:00-23:00', slot: 'night',
      tags: ['亲子友好', '摄影出片', '轻松休闲'],
      bg: '贺兰山脚下的沉浸式演艺小镇，把温泉、市集与夜间演出装进同一片山谷。',
      hl: '夜间沉浸式实景演出、露天温泉、山景星空与市集小食。'
    },
    {
      id: 'zhy', name: '志辉源石葡萄酒庄', district: '西夏区', level: '4A',
      cat: 'winery',
      lng: 106.0080, lat: 38.5980, urban: false, roadKph: 48,
      stay: 90, ticket: 60, open: '09:00-17:30', slot: 'day',
      tags: ['酒庄品鉴', '人文历史', '轻松休闲'],
      bg: '贺兰山东麓镇北堡产区的精品酒庄，酒窖依山凿建，是宁夏葡萄酒产业的地标之一。',
      hl: '山洞酒窖参观、源石系列品鉴、葡萄园与贺兰山对望的观景台。'
    },
    {
      id: 'zy', name: '宁夏张裕龙谕酒庄', district: '西夏区', level: '4A',
      cat: 'winery',
      lng: 106.1080, lat: 38.4700, urban: true, roadKph: 58,
      stay: 90, ticket: 60, open: '08:30-17:00', slot: 'day',
      tags: ['酒庄品鉴', '人文历史', '轻松休闲'],
      bg: '张裕在贺兰山东麓产区的主力酒庄，城堡式主体建筑与地下酒窖一体。',
      hl: '地下酒窖参观、龙谕系列品鉴、酒庄零售与葡萄园观光。'
    },
    {
      id: 'gzk', name: '滚钟口风景区', district: '西夏区', level: '',
      cat: 'mountain',
      lng: 106.0180, lat: 38.5620, urban: false, roadKph: 48,
      stay: 150, ticket: 40, open: '08:00-17:00', slot: 'day',
      tags: ['自然风光', '摄影出片'],
      bg: '贺兰山东麓的小口子，峡谷内古寺与松林相依，是银川人传统的夏季避暑地。',
      hl: '笔架峰、贺兰庙、峡谷石阶与山泉；登顶可俯瞰银川平原。'
    },
    {
      id: 'hy', name: '怀远观光夜市', district: '西夏区', level: '',
      cat: 'night',
      lng: 106.1360, lat: 38.4980, urban: true, roadKph: 58,
      stay: 90, ticket: 0, open: '17:00-24:00', slot: 'night',
      tags: ['美食体验', '轻松休闲'],
      bg: '大学城旁的银川人气夜市，集中了本地小吃与西北夜宵。',
      hl: '羊肉串、辣糊糊、羊杂碎、手抓饭、甜醅子与牛奶醪糟。'
    },
    {
      id: 'mnry', name: '蒙牛乳业（银川）旅游景区', district: '西夏区', level: '',
      cat: 'museum',
      lng: 106.1700, lat: 38.4560, urban: true, roadKph: 58,
      stay: 90, ticket: 30, open: '09:00-16:00（需预约）', slot: 'day',
      tags: ['科普研学', '亲子友好'],
      bg: '西夏区宝湖西路的乳品观光工厂，隔着玻璃看整条液态奶生产线运转。',
      hl: '生产线参观通道、乳品知识展厅、亲子研学课程。'
    },

    /* ============ 兴庆区 · 老城与黄河东岸 ============ */
    {
      id: 'hbt', name: '海宝塔景区', district: '兴庆区', level: '3A',
      cat: 'pagoda',
      lng: 106.2860, lat: 38.4830, urban: true, roadKph: 58,
      stay: 60, ticket: 5, open: '09:00-17:00', slot: 'day',
      tags: ['人文历史', '轻松休闲'],
      bg: '俗称北塔，始建年代不晚于北朝，经西夏重修，为全国重点文物保护单位。',
      hl: '楼阁式砖砌塔身与「亚」字形平面、寺院中轴格局与安静院落。'
    },
    {
      id: 'cts', name: '承天寺塔（西塔）', district: '兴庆区', level: '',
      cat: 'pagoda',
      lng: 106.2790, lat: 38.4640, urban: true, roadKph: 58,
      stay: 60, ticket: 10, open: '08:30-17:30', slot: 'day',
      tags: ['人文历史'],
      bg: '始建于西夏崇宗天祐垂圣元年，是宁夏现存最高大的古塔，通高约 64.5 米。',
      hl: '登塔俯瞰银川老城天际线、寺内碑廊与古银杏。'
    },
    {
      id: 'yhg', name: '玉皇阁', district: '兴庆区', level: '',
      cat: 'pagoda',
      lng: 106.2905, lat: 38.4690, urban: true, roadKph: 58,
      stay: 45, ticket: 10, open: '09:00-17:00', slot: 'day',
      tags: ['人文历史', '摄影出片'],
      bg: '明代宁夏卫城内的楼阁式古建，坐落在老城中心，是解放街的地标。',
      hl: '三层重檐楼阁与砖雕、登阁看老城街景、与鼓楼对望。'
    },
    {
      id: 'mch', name: '银川鸣翠湖国家湿地公园', district: '兴庆区', level: '4A',
      cat: 'lake',
      lng: 106.3480, lat: 38.4180, urban: false, roadKph: 32,
      stay: 150, ticket: 40, open: '08:30-18:00', slot: 'day',
      tags: ['自然风光', '亲子友好', '摄影出片'],
      bg: '距市区约 9 公里的黄河灌区湖泊湿地，千亩荷塘与芦苇迷宫相连。',
      hl: '千亩荷塘栈道、芦苇迷宫游船、53 米观景塔、萌宠乐园。'
    },
    {
      id: 'hhc', name: '黄河横城旅游度假区', district: '兴庆区', level: '4A',
      cat: 'river',
      lng: 106.4560, lat: 38.3480, urban: false, roadKph: 52,
      stay: 120, ticket: 40, open: '09:00-18:00', slot: 'day',
      tags: ['人文历史', '自然风光', '亲子友好'],
      bg: '黄河东岸的渡口古镇，横城古渡曾是明代宁夏的黄河水运枢纽，如今是黄河文化主题度假区。',
      hl: '横城古渡水车、黄河栈道、羊皮筏子漂流、清水营明长城。'
    },
    {
      id: 'hjjs', name: '黄河军事文化博览园', district: '兴庆区', level: '4A',
      cat: 'river',
      lng: 106.4700, lat: 38.3560, urban: false, roadKph: 52,
      stay: 120, ticket: 60, open: '09:00-17:30', slot: 'day',
      tags: ['科普研学', '亲子友好', '人文历史'],
      bg: '银川舰退役后落户黄河岸边，是国内少见的以退役舰艇为主体的军事主题园区。',
      hl: '登上「银川舰」参观舰桥与舱室、潜艇与歼击机实物、军事装备展区。'
    },
    {
      id: 'hsgd', name: '黄沙古渡原生态旅游区', district: '兴庆区', level: '4A',
      cat: 'river',
      lng: 106.6010, lat: 38.4720, urban: false, roadKph: 42,
      stay: 180, ticket: 60, open: '08:00-17:00', slot: 'day',
      tags: ['自然风光', '亲子友好', '摄影出片'],
      bg: '兴庆区月牙湖乡的黄河古渡口，一边是黄河，一边是毛乌素沙地。',
      hl: '骑骆驼、滑沙、羊皮筏子、黄河与大漠同框的日落。'
    },
    {
      id: 'xyc', name: '宁夏薰衣草庄园', district: '兴庆区', level: '3A',
      cat: 'bloom',
      lng: 106.4800, lat: 38.3300, urban: false, roadKph: 52,
      stay: 90, ticket: 50, open: '09:00-18:00（花期 6-9 月）', slot: 'day',
      tags: ['摄影出片', '轻松休闲', '亲子友好'],
      bg: '滨河新区黄河东岸的花田庄园，以薰衣草与马鞭草为主打。',
      hl: '花田步道与紫色花海、风车与观景台、花期时节的婚纱旅拍。'
    },
    {
      id: 'hhwt', name: '黄河外滩国家湿地公园', district: '兴庆区', level: '3A',
      cat: 'river',
      lng: 106.4420, lat: 38.3400, urban: false, roadKph: 52,
      stay: 90, ticket: 0, open: '全天开放', slot: 'day',
      tags: ['自然风光', '轻松休闲', '摄影出片'],
      bg: '滨河新区紧贴黄河的带状湿地公园，是银川看黄河落日的免费去处。',
      hl: '黄河落日与大桥剪影、湿地芦苇与候鸟、滨河骑行道。'
    },

    /* ============ 金凤区 · 城市新区 ============ */
    {
      id: 'nxbwg', name: '宁夏博物馆', district: '金凤区', level: '',
      cat: 'museum',
      lng: 106.2320, lat: 38.4880, urban: true, roadKph: 58,
      stay: 120, ticket: 0, open: '09:00-17:00（周一闭馆）', slot: 'day',
      tags: ['人文历史', '科普研学', '亲子友好'],
      bg: '国家一级博物馆，系统展示宁夏自远古至今的历史脉络与西夏文明。',
      hl: '鎏金铜牛、石刻胡旋舞墓门、西夏碑刻与《吉祥遍至口和本续》活字印本。'
    },
    {
      id: 'nxdz', name: '宁夏地质博物馆', district: '金凤区', level: '3A',
      cat: 'museum',
      lng: 106.2350, lat: 38.4860, urban: true, roadKph: 58,
      stay: 90, ticket: 0, open: '09:00-17:00（周一闭馆）', slot: 'day',
      tags: ['科普研学', '亲子友好'],
      bg: '国家二级博物馆，馆藏以宁夏及邻区的矿物、岩石、古生物化石为主。',
      hl: '巨型恐龙化石与地层剖面、贺兰山矿物晶体、4D 影院。'
    },
    {
      id: 'ls', name: '览山公园', district: '金凤区', level: '',
      cat: 'bloom',
      lng: 106.2150, lat: 38.5200, urban: true, roadKph: 58,
      stay: 90, ticket: 0, open: '全天开放', slot: 'day',
      tags: ['摄影出片', '轻松休闲'],
      bg: '仿古罗马斗兽场式露天剧场建在山坡上，正对贺兰山主峰方向。',
      hl: '贺兰山日落、罗马式拱券回廊、大台阶人像机位、银川夜景。'
    },
    {
      id: 'yh', name: '阅海国家湿地公园', district: '金凤区', level: '3A',
      cat: 'lake',
      lng: 106.2210, lat: 38.5340, urban: true, roadKph: 58,
      stay: 120, ticket: 0, open: '08:30-18:00', slot: 'day',
      tags: ['自然风光', '轻松休闲', '亲子友好'],
      bg: '金凤区北部的城市湖泊湿地，是银川「塞上湖城」格局的代表片区。',
      hl: '阅海环湖游船、欢乐岛游乐设施、冬季冰雪项目、湖畔芦苇栈道。'
    },
    {
      id: 'hby', name: '银川花博园', district: '金凤区', level: '',
      cat: 'bloom',
      lng: 106.2130, lat: 38.5520, urban: true, roadKph: 58,
      stay: 120, ticket: 0, open: '09:00-21:00', slot: 'both',
      tags: ['摄影出片', '亲子友好', '轻松休闲'],
      bg: '中阿博览会的举办地，如今是银川最大的城市园艺主题公园。',
      hl: '四季花海与主题展园、梦幻海洋企鹅馆、山海之夜夜游船。'
    },
    {
      id: 'sm', name: '森淼生态旅游区', district: '金凤区', level: '3A',
      cat: 'lake',
      lng: 106.2110, lat: 38.4300, urban: true, roadKph: 58,
      stay: 120, ticket: 30, open: '08:00-18:00', slot: 'day',
      tags: ['自然风光', '亲子友好', '轻松休闲'],
      bg: '金凤区南绕城旁的生态园区，葡萄长廊与林果采摘连成一片。',
      hl: '葡萄长廊、百果园采摘、林下烧烤与亲子农场。'
    },
    {
      id: 'whzx', name: '银川文化艺术博览中心', district: '金凤区', level: '3A',
      cat: 'museum',
      lng: 106.2380, lat: 38.4560, urban: true, roadKph: 58,
      stay: 90, ticket: 0, open: '10:00-18:00（周一闭馆）', slot: 'day',
      tags: ['人文历史', '科普研学', '亲子友好'],
      bg: '金凤区宁安大街的城市文化综合体，常年举办主题展览与城市形象展。',
      hl: '城市形象展馆、非遗手作体验、临展与艺术市集。'
    },

    /* ============ 贺兰县 · 贺兰山北段 ============ */
    {
      id: 'slgy', name: '贺兰山国家森林公园（苏峪口）', district: '贺兰县', level: '4A',
      cat: 'mountain',
      lng: 105.9760, lat: 38.6120, urban: false, roadKph: 46,
      stay: 180, ticket: 60, open: '08:00-16:30', slot: 'day',
      tags: ['自然风光', '摄影出片', '科普研学'],
      bg: '贺兰山国家级自然保护区，宁夏平原的天然屏障，也是西夏王朝的皇家苑囿。',
      hl: '青松岭缆车、樱桃谷峡谷步道、云杉林与「贺兰晴雪」远景。'
    },
    {
      id: 'yhs', name: '贺兰山岩画', district: '贺兰县', level: '4A',
      cat: 'relic',
      lng: 105.9700, lat: 38.7020, urban: false, roadKph: 46,
      stay: 120, ticket: 60, open: '08:00-18:00', slot: 'day',
      tags: ['人文历史', '科普研学', '摄影出片'],
      bg: '贺兰口峡谷两侧的古代岩画群，6000 余幅作品，距今约 3000 至 10000 年。',
      hl: '「太阳神」岩画、银川世界岩画馆、韩美林艺术馆、贺兰飞瀑。'
    },
    {
      id: 'bry', name: '宁夏百瑞源枸杞博物馆', district: '贺兰县', level: '4A',
      cat: 'museum',
      lng: 106.3320, lat: 38.5620, urban: false, roadKph: 45,
      stay: 90, ticket: 20, open: '07:00-20:00（夏季）', slot: 'day',
      tags: ['科普研学', '亲子友好', '美食体验'],
      bg: '贺兰县德胜工业园区的枸杞主题场馆，系统讲清宁夏枸杞的种植与加工。',
      hl: '枸杞种质资源展、加工生产线参观、枸杞芽茶与深加工产品体验。'
    },
    {
      id: 'h1958', name: '贺兰山·1958 主题创意休闲区', district: '贺兰县', level: '3A',
      cat: 'art',
      lng: 106.1180, lat: 38.6600, urban: false, roadKph: 48,
      stay: 120, ticket: 0, open: '09:00-21:00', slot: 'both',
      tags: ['人文历史', '摄影出片', '轻松休闲'],
      bg: '由 1958 年建成的老工业厂区改造，红砖厂房与贺兰山景同框。',
      hl: '工业风文创空间、艺术展览与市集、夜间灯光与露天演出。'
    },
    {
      id: 'dykj', name: '宁夏稻渔空间乡村生态观光园', district: '贺兰县', level: '3A',
      cat: 'lake',
      lng: 106.3020, lat: 38.6180, urban: false, roadKph: 45,
      stay: 120, ticket: 30, open: '08:30-18:00', slot: 'day',
      tags: ['自然风光', '亲子友好', '摄影出片'],
      bg: '贺兰县常信乡的稻渔共生示范区，稻田画与鱼塘构成典型的塞上田园。',
      hl: '稻田画观赏台、稻渔共生科普、小火车环线与农事体验。'
    },
    {
      id: 'hjz', name: '贺金樽酒庄', district: '贺兰县', level: 'AA',
      cat: 'winery',
      lng: 105.9980, lat: 38.6820, urban: false, roadKph: 48,
      stay: 90, ticket: 0, open: '09:00-17:30（需预约）', slot: 'day',
      tags: ['酒庄品鉴', '轻松休闲'],
      bg: '贺兰县金山国际葡萄试验区的酒庄，位于贺兰山东麓海拔较高的子产区。',
      hl: '葡萄园参观、酒窖品鉴、金山产区风土讲解。'
    },

    /* ============ 永宁县 · 玉泉营与闽宁镇 ============ */
    {
      id: 'hxht', name: '华夏河图·银川艺术小镇', district: '永宁县', level: '4A',
      cat: 'art',
      lng: 106.3300, lat: 38.2960, urban: false, roadKph: 54,
      stay: 150, ticket: 0, open: '09:30-18:00（周一闭馆）', slot: 'day',
      tags: ['人文历史', '摄影出片', '亲子友好'],
      bg: '黄河边上的艺术聚落，把美术馆、艺术家村与湿地景观放在同一片园区。',
      hl: '银川当代美术馆建筑本体、国际艺术家村、黄河湿地栈道。'
    },
    {
      id: 'ddmsg', name: '银川当代美术馆', district: '永宁县', level: '',
      cat: 'art',
      lng: 106.3270, lat: 38.3020, urban: false, roadKph: 54,
      stay: 90, ticket: 20, open: '10:00-18:00（17:30 停止入园，周一闭馆）', slot: 'day',
      tags: ['人文历史', '摄影出片'],
      bg: '大西北黄河畔的专业当代美术馆，建筑本身即是展品。',
      hl: '当代艺术常设与临展、建筑空间摄影、美术馆咖啡与黄河景观。'
    },
    {
      id: 'yq', name: '玉泉国际酒庄', district: '永宁县', level: '4A',
      cat: 'winery',
      lng: 105.9850, lat: 38.1950, urban: false, roadKph: 54,
      stay: 90, ticket: 60, open: '09:00-17:30', slot: 'day',
      tags: ['酒庄品鉴', '人文历史'],
      bg: '永宁县玉泉营葡萄小镇的核心酒庄，紧邻贺兰山东麓最老的葡萄基地之一。',
      hl: '葡萄博览路沿线酒庄群、地下酒窖、玉泉营产区品鉴。'
    },
    {
      id: 'zllc', name: '中粮长城天赋酒庄', district: '永宁县', level: '3A',
      cat: 'winery',
      lng: 105.9480, lat: 38.1580, urban: false, roadKph: 54,
      stay: 90, ticket: 60, open: '09:00-17:00', slot: 'day',
      tags: ['酒庄品鉴', '人文历史'],
      bg: '位于永宁县闽宁镇云漠路，中粮长城在贺兰山东麓产区的酒庄。',
      hl: '酿造车间与酒窖参观、天赋系列品鉴、闽宁镇葡萄园景观。'
    },
    {
      id: 'mnz', name: '闽宁新貌展示中心', district: '永宁县', level: '',
      cat: 'museum',
      lng: 105.9430, lat: 38.1610, urban: false, roadKph: 54,
      stay: 90, ticket: 0, open: '09:00-17:00', slot: 'day',
      tags: ['红色研学', '人文历史', '科普研学'],
      bg: '闽宁镇的移民搬迁主题展馆，记录「干沙滩变金沙滩」的东西部协作历程。',
      hl: '闽宁协作历程展、移民新村实景、闽宁镇葡萄酒与菌菇产业。'
    },
    {
      id: 'sch', name: '宋澄湖旅游景区', district: '永宁县', level: '',
      cat: 'lake',
      lng: 106.1780, lat: 38.2700, urban: false, roadKph: 54,
      stay: 90, ticket: 0, open: '全天开放', slot: 'day',
      tags: ['自然风光', '轻松休闲'],
      bg: '永宁县望洪镇的湖泊湿地，紧邻新华中心村，是银川南部的乡村休闲点。',
      hl: '环湖步道与荷花、乡村采摘、湖畔垂钓。'
    },

    /* ============ 灵武市 · 黄河东岸与宁东 ============ */
    {
      id: 'sdg', name: '水洞沟旅游区', district: '灵武市', level: '5A',
      cat: 'relic',
      lng: 106.4610, lat: 38.2880, urban: false, roadKph: 48,
      stay: 210, ticket: 60, open: '08:00-18:00', slot: 'day',
      tags: ['人文历史', '自然风光', '科普研学'],
      bg: '中国史前考古发祥地之一，旧石器时代遗址与明代长城、雅丹地貌叠在同一片土地上。',
      hl: '藏兵洞地下军事体系、水洞沟遗址博物院、魔鬼城与红山湖、明长城遗址。'
    },
    {
      id: 'kl', name: '宁夏灵武恐龙地质公园', district: '灵武市', level: '3A',
      cat: 'relic',
      lng: 106.5910, lat: 38.0360, urban: false, roadKph: 52,
      stay: 120, ticket: 60, open: '09:00-17:00', slot: 'day',
      tags: ['科普研学', '亲子友好'],
      bg: '宁东镇磁窑堡的恐龙化石遗迹园，出土了亚洲最大的蜥脚类恐龙化石之一。',
      hl: '原址化石剖面、恐龙化石展厅、灵武龙复原骨架。'
    },
    {
      id: 'cls', name: '长流水生态旅游区', district: '灵武市', level: '3A',
      cat: 'lake',
      lng: 106.2450, lat: 37.9600, urban: false, roadKph: 52,
      stay: 150, ticket: 40, open: '08:30-18:00', slot: 'day',
      tags: ['自然风光', '亲子友好', '摄影出片'],
      bg: '灵武市白土岗的沙漠边缘生态区，泉水、沙丘与沟壑在短距离内切换。',
      hl: '沙漠峡谷徒步、泉眼与湿地、滑沙与沙漠越野。'
    },
    {
      id: 'lwgm', name: '灵武高庙', district: '灵武市', level: '',
      cat: 'pagoda',
      lng: 106.3390, lat: 38.1020, urban: false, roadKph: 54,
      stay: 60, ticket: 20, open: '08:30-17:30', slot: 'day',
      tags: ['人文历史', '摄影出片'],
      bg: '始建于明代的楼阁式建筑群，清代被震毁后重建，是灵武老城的地标。',
      hl: '三层重檐楼阁与砖雕、登高看灵武城、老城街巷。'
    },
    {
      id: 'qsy', name: '清水营影视城', district: '灵武市', level: '',
      cat: 'sier',
      lng: 106.6420, lat: 38.1820, urban: false, roadKph: 52,
      stay: 120, ticket: 40, open: '08:30-18:00', slot: 'day',
      tags: ['人文历史', '摄影出片'],
      bg: '明长城清水营堡遗址上建起的影视拍摄地，土黄色城堡群贴着毛乌素沙地南缘。',
      hl: '明长城遗址与堡城残垣、影视置景街区、荒漠戈壁取景。'
    }
  ],

  /* 餐饮 POI：午餐由坐标就近检索，不再按片区人工写死 */
  eats: [
    { id: 'e-xyh', name: '老毛手抓（解放东街）', district: '兴庆区', lng: 106.2880, lat: 38.4690, note: '手抓羊肉、羊肉臊子面' },
    { id: 'e-ybl', name: '迎宾楼（新华东街）', district: '兴庆区', lng: 106.2830, lat: 38.4710, note: '老字号清真菜' },
    { id: 'e-ngs', name: '南关清真寺周边小吃街', district: '兴庆区', lng: 106.2760, lat: 38.4560, note: '羊杂碎、烩小吃' },
    { id: 'e-dyc', name: '建发大阅城美食层', district: '金凤区', lng: 106.2180, lat: 38.5000, note: '宁夏菜与各地风味集中' },
    { id: 'e-yhw', name: '阅海湾中央公园周边', district: '金凤区', lng: 106.2300, lat: 38.4900, note: '商圈餐饮，选择多' },
    { id: 'e-sm', name: '森淼生态区林下餐厅', district: '金凤区', lng: 106.2110, lat: 38.4310, note: '农家菜与烧烤' },
    { id: 'e-hyy', name: '怀远观光夜市', district: '西夏区', lng: 106.1360, lat: 38.4980, note: '羊肉串、辣糊糊、甜醅子' },
    { id: 'e-xwd', name: '西夏万达广场餐饮层', district: '西夏区', lng: 106.1040, lat: 38.4760, note: '连锁餐饮与本地菜' },
    { id: 'e-zbb', name: '镇北堡景区餐厅（影城对面）', district: '西夏区', lng: 105.9970, lat: 38.6340, note: '景区里最稳的午餐点' },
    { id: 'e-ds', name: '德胜工业园区餐饮区', district: '贺兰县', lng: 106.3300, lat: 38.5600, note: '枸杞宴与本地家常菜' },
    { id: 'e-1958', name: '贺兰山·1958 园区餐厅', district: '贺兰县', lng: 106.1180, lat: 38.6600, note: '工业风园区内的简餐' },
    { id: 'e-mnz', name: '闽宁镇农家宴', district: '永宁县', lng: 105.9450, lat: 38.1590, note: '滩羊与菌菇，移民新村特色' },
    { id: 'e-yq', name: '玉泉营酒庄餐厅', district: '永宁县', lng: 105.9860, lat: 38.1960, note: '酒庄配餐' },
    { id: 'e-hxht', name: '华夏河图园区餐厅', district: '永宁县', lng: 106.3210, lat: 38.3200, note: '美术馆旁简餐咖啡' },
    { id: 'e-lw', name: '灵武老城羊肉馆', district: '灵武市', lng: 106.3390, lat: 38.1030, note: '灵武羊肉、手擀面' },
    { id: 'e-lh', name: '临河镇黄河渔家', district: '灵武市', lng: 106.4600, lat: 38.2870, note: '黄河鲤鱼' }
  ]
};
