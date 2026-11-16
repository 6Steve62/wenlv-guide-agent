/* =============================================================================
 * 数据包 · 住宿驻点（免费替代「定位 API」的那一步）
 * -----------------------------------------------------------------------------
 * 为什么需要这个文件
 *   用户真正的需求是「已知我住哪儿，行程从那里开始」。实现它有两条路：
 *     A. 接地图 API：定位 → 逆地理编码 → POI 检索，拿到酒店名与坐标
 *     B. 用一份住宿片区数据包，让用户直接选
 *   路线 A 的隐性成本远高于表面：实名认证、Key 白名单、调用配额、POI 不得
 *   落库的合规限制、以及 file:// 本地打开时的授权与跨域摩擦。
 *   而行程规划对酒店坐标的精度要求极低——差 2 公里不会改变「今天去西夏区
 *   还是兴庆区」的判断。所以路线 B 用不到 5% 的成本覆盖了 90% 的场景。
 *
 * 与引擎的关系
 *   本文件不进入景点候选池（没有 attractions 字段），只供界面层选择「行程驻点」。
 *   选中后作为 base 传给引擎，引擎在此之前已支持任意坐标作为驻点。
 *
 * 字段说明
 *   district   所属区县（市），与景点数据同口径
 *   group      界面分组名
 *   kind       城区 | 镇区 | 景区 | 县城 | 周边城市 —— 仅用于界面标注
 *   lng / lat  GCJ-02 近似坐标
 *   urban      是否位于市区建成区内（影响拥堵时速）
 *   roadKph    非市区路段典型时速
 *   note       适用场景说明，直接显示给用户
 *
 * 坐标口径
 *   市区三区的驻点锚定在已有 POI 坐标上（商业区、夜市、博物馆等），保证与景点
 *   数据同一口径；区县城区与周边市区的坐标为城区中心近似值。全部为 GCJ-02。
 *
 * 数据说明：住宿片区为常见落脚区域的代表点，非具体酒店；如需精确到门牌，
 *   可接入地图开放平台的 POI 检索（见 地图接入方案.md）。
 * ========================================================================== */

window.CITY_DATA = window.CITY_DATA || {};

window.CITY_DATA.lodging = {
  id: 'lodging',
  name: '住宿驻点',
  subtitle: '30 个常见落脚片区',
  coordSystem: 'GCJ-02',

  lodgings: [
    /* ============ 兴庆区 · 老城 ============ */
    { id: 'lod-xinhua', name: '新华街商圈', district: '兴庆区', group: '兴庆区 · 老城', kind: '城区',
      lng: 106.2810, lat: 38.4700, urban: true, roadKph: 58, isDefault: true,
      note: '老城中心，餐饮与交通最集中，去各方向都居中' },
    { id: 'lod-gulou', name: '鼓楼 · 解放街', district: '兴庆区', group: '兴庆区 · 老城', kind: '城区',
      lng: 106.2900, lat: 38.4685, urban: true, roadKph: 58,
      note: '步行可达玉皇阁与承天寺塔，老城游览零车程起步' },
    { id: 'lod-nanmen', name: '南门广场', district: '兴庆区', group: '兴庆区 · 老城', kind: '城区',
      lng: 106.2770, lat: 38.4565, urban: true, roadKph: 58,
      note: '老城南侧，往黄河东岸方向出发顺路' },
    { id: 'lod-beita', name: '北塔 · 海宝塔周边', district: '兴庆区', group: '兴庆区 · 老城', kind: '城区',
      lng: 106.2865, lat: 38.4855, urban: true, roadKph: 58,
      note: '环境安静，紧邻海宝塔景区，往贺兰县方向少绕路' },
    { id: 'lod-yueyahu', name: '月牙湖乡（黄沙古渡方向）', district: '兴庆区', group: '兴庆区 · 老城', kind: '镇区',
      lng: 106.5900, lat: 38.4750, urban: false, roadKph: 42,
      note: '乡村民宿，适合早起玩沙漠与黄河，但进市区较远' },

    /* ============ 金凤区 · 城市新区 ============ */
    { id: 'lod-wanda', name: '万达 · 大阅城商圈', district: '金凤区', group: '金凤区 · 城市新区', kind: '城区',
      lng: 106.2180, lat: 38.5000, urban: true, roadKph: 58,
      note: '商圈成熟，到宁夏博物馆与览山公园都很近' },
    { id: 'lod-yuehai', name: '阅海湾 · 阅海公园旁', district: '金凤区', group: '金凤区 · 城市新区', kind: '城区',
      lng: 106.2230, lat: 38.5290, urban: true, roadKph: 58,
      note: '湖景房集中，亲子出行方便，往花博园顺路' },
    { id: 'lod-bowuguan', name: '博物馆 · 文化城', district: '金凤区', group: '金凤区 · 城市新区', kind: '城区',
      lng: 106.2320, lat: 38.4880, urban: true, roadKph: 58,
      note: '紧邻宁夏博物馆与地质博物馆，两家馆步行可达' },
    { id: 'lod-ningsha', name: '宁安大街 · 宝湖路', district: '金凤区', group: '金凤区 · 城市新区', kind: '城区',
      lng: 106.2380, lat: 38.4560, urban: true, roadKph: 58,
      note: '新城南部，上绕城高速快，往永宁、灵武方向省时间' },

    /* ============ 西夏区 · 贺兰山东麓 ============ */
    { id: 'lod-xixiawanda', name: '西夏万达 · 怀远路', district: '西夏区', group: '西夏区 · 贺兰山东麓', kind: '城区',
      lng: 106.1040, lat: 38.4760, urban: true, roadKph: 58,
      note: '西夏区商圈，去张裕龙谕酒庄与西夏风情园最方便' },
    { id: 'lod-daxuecheng', name: '大学城 · 怀远夜市', district: '西夏区', group: '西夏区 · 贺兰山东麓', kind: '城区',
      lng: 106.1360, lat: 38.4980, urban: true, roadKph: 58,
      note: '夜市就在楼下，晚上回来还能吃一顿' },
    { id: 'lod-zhenbeibao', name: '镇北堡镇（影城旁）', district: '西夏区', group: '西夏区 · 贺兰山东麓', kind: '景区',
      lng: 105.9980, lat: 38.6330, urban: false, roadKph: 50,
      note: '住在影城门口，第二天最早进景区，省一趟往返' },
    { id: 'lod-gunzhongkou', name: '滚钟口 · 山脚民宿', district: '西夏区', group: '西夏区 · 贺兰山东麓', kind: '景区',
      lng: 106.0150, lat: 38.5640, urban: false, roadKph: 46,
      note: '贺兰山脚，主打山景与安静，适合早起徒步' },

    /* ============ 贺兰县 · 贺兰山北段 ============ */
    { id: 'lod-helanxian', name: '贺兰县城（习岗镇）', district: '贺兰县', group: '贺兰县 · 贺兰山北段', kind: '县城',
      lng: 106.3460, lat: 38.5560, urban: false, roadKph: 50,
      note: '县城住宿性价比高，去德胜园区与稻渔空间都近' },
    { id: 'lod-desheng', name: '德胜工业园区', district: '贺兰县', group: '贺兰县 · 贺兰山北段', kind: '城区',
      lng: 106.3320, lat: 38.5620, urban: false, roadKph: 50,
      note: '紧邻百瑞源枸杞博物馆，商务出差住这里多' },
    { id: 'lod-suyukou', name: '苏峪口 · 岩画沟口', district: '贺兰县', group: '贺兰县 · 贺兰山北段', kind: '景区',
      lng: 105.9750, lat: 38.6800, urban: false, roadKph: 46,
      note: '山脚农家院，适合清早上山看岩画与森林公园' },
    { id: 'lod-1958', name: '贺兰山 · 1958 创意区', district: '贺兰县', group: '贺兰县 · 贺兰山北段', kind: '景区',
      lng: 106.1180, lat: 38.6600, urban: false, roadKph: 48,
      note: '工业风园区，夜里有演出与灯光，住着省一趟夜路' },

    /* ============ 永宁县 · 玉泉营与闽宁镇 ============ */
    { id: 'lod-yongningxian', name: '永宁县城（杨和镇）', district: '永宁县', group: '永宁县 · 玉泉营与闽宁镇', kind: '县城',
      lng: 106.2530, lat: 38.2800, urban: false, roadKph: 54,
      note: '县城住宿便宜，去宋澄湖与华夏河图方便' },
    { id: 'lod-yuquanying', name: '玉泉营葡萄小镇', district: '永宁县', group: '永宁县 · 玉泉营与闽宁镇', kind: '镇区',
      lng: 105.9850, lat: 38.1950, urban: false, roadKph: 54,
      note: '酒庄环绕，适合以品鉴为主题的行程' },
    { id: 'lod-minningzhen', name: '闽宁镇', district: '永宁县', group: '永宁县 · 玉泉营与闽宁镇', kind: '镇区',
      lng: 105.9430, lat: 38.1610, urban: false, roadKph: 54,
      note: '移民新村，红色研学与葡萄酒产区落脚点' },
    { id: 'lod-hxht', name: '华夏河图 · 黄河东岸', district: '永宁县', group: '永宁县 · 玉泉营与闽宁镇', kind: '景区',
      lng: 106.3300, lat: 38.2960, urban: false, roadKph: 54,
      note: '美术馆旁，适合看黄河落日与当代艺术' },

    /* ============ 灵武市 · 黄河东岸与宁东 ============ */
    { id: 'lod-lingwushi', name: '灵武老城区', district: '灵武市', group: '灵武市 · 黄河东岸与宁东', kind: '城区',
      lng: 106.3390, lat: 38.1020, urban: false, roadKph: 54,
      note: '市区住宿，去灵武高庙步行可达，往水洞沟顺路' },
    { id: 'lod-linhezhen', name: '临河镇（水洞沟 · 机场方向）', district: '灵武市', group: '灵武市 · 黄河东岸与宁东', kind: '镇区',
      lng: 106.4400, lat: 38.3000, urban: false, roadKph: 52,
      note: '紧邻河东机场，赶早班机或落地当天出行首选' },
    { id: 'lod-ningdong', name: '宁东镇', district: '灵武市', group: '灵武市 · 黄河东岸与宁东', kind: '城区',
      lng: 106.5910, lat: 38.0360, urban: false, roadKph: 52,
      note: '能源基地，商务出差多；游恐龙地质公园最近' },
    { id: 'lod-changliushui', name: '白土岗（长流水方向）', district: '灵武市', group: '灵武市 · 黄河东岸与宁东', kind: '镇区',
      lng: 106.2450, lat: 37.9600, urban: false, roadKph: 52,
      note: '沙漠边缘，适合长流水生态区与沙漠徒步' },

    /* ============ 银川周边 · 石嘴山 / 吴忠 / 中卫 ============ */
    { id: 'lod-pingluo', name: '石嘴山 · 平罗县城', district: '平罗县', group: '银川周边 · 石嘴山 / 吴忠 / 中卫', kind: '周边城市',
      lng: 106.5230, lat: 38.9060, urban: false, roadKph: 50,
      note: '去沙湖前的落脚点，比从银川出发省一趟早高峰' },
    { id: 'lod-shanhukou', name: '沙湖景区门口', district: '平罗县', group: '银川周边 · 石嘴山 / 吴忠 / 中卫', kind: '景区',
      lng: 106.3650, lat: 38.8200, urban: false, roadKph: 50,
      note: '住景区旁，从日出待到日落，沙湖一天玩透' },
    { id: 'lod-qingtongxia', name: '吴忠 · 青铜峡市区', district: '青铜峡市', group: '银川周边 · 石嘴山 / 吴忠 / 中卫', kind: '周边城市',
      lng: 106.0780, lat: 38.0210, urban: false, roadKph: 52,
      note: '黄河大峡谷与一百零八塔的基地，本地美食也好找' },
    { id: 'lod-zhongwei', name: '中卫 · 沙坡头区', district: '中卫市', group: '银川周边 · 石嘴山 / 吴忠 / 中卫', kind: '周边城市',
      lng: 105.1900, lat: 37.5150, urban: false, roadKph: 80,
      note: '沙坡头方向。距银川各景区较远，用于验证跨城场景' }
  ]
};
