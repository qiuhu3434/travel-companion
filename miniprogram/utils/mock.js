/**
 * 雨筹出行规划 - 模拟数据
 *
 * 当后端 API 不可用时（Key 未配置、网络异常等），
 * 使用模拟数据保证页面正常展示，用户可继续使用核心功能。
 */

/**
 * 模拟天气预报
 */
function mockForecast(city) {
  const cities = {
    '杭州': { temps: [27,34], desc: ['晴', '多云', '小雨', '阴', '多云', '晴', '雷阵雨'], wind: '东南风3级' },
    '北京': { temps: [22,33], desc: ['多云', '晴', '晴', '阴', '小雨', '多云', '晴'], wind: '北风2级' },
    '上海': { temps: [26,33], desc: ['多云', '阴', '小雨', '小雨', '多云', '晴', '晴'], wind: '东风4级' },
    '成都': { temps: [23,31], desc: ['阴', '小雨', '小雨', '阴', '多云', '多云', '晴'], wind: '微风2级' },
    '广州': { temps: [27,35], desc: ['雷阵雨', '多云', '晴', '晴', '多云', '雷阵雨', '晴'], wind: '南风3级' },
  };

  const data = cities[city] || cities['杭州'];
  const result = [];
  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const tempMin = data.temps[0] + Math.round(Math.random() * 3) - 1;
    const tempMax = data.temps[1] + Math.round(Math.random() * 3) - 1;
    result.push({
      date: dateStr,
      textDay: data.desc[i % data.desc.length],
      textNight: data.desc[i % data.desc.length],
      tempMin: String(tempMin),
      tempMax: String(tempMax),
      windDirDay: data.wind.replace(/[0-9级]/g, ''),
      windScaleDay: data.wind.match(/[0-9]/)?.[0] || '3',
      humidity: String(50 + Math.round(Math.random() * 30)),
      precip: i % 3 === 0 ? '2.5' : '0',
      uvIndex: String(3 + i % 5)
    });
  }
  return result;
}

/**
 * 模拟实时天气
 */
function mockNow(city) {
  return {
    temp: 32,
    text: '晴',
    windDir: '东南',
    windScale: '3',
    humidity: '65',
    precip: '0',
    feelsLike: '35',
    obsTime: new Date().toISOString()
  };
}

/**
 * 模拟地点搜索结果
 */
function mockPoiList(keyword, type) {
  const allPois = [
    { name: '西湖风景名胜区', address: '杭州市西湖区龙井路1号', type: '景点', tel: '0571-87179617', rating: '4.8' },
    { name: '灵隐寺', address: '杭州市西湖区法云弄1号', type: '景点', tel: '0571-87968665', rating: '4.7' },
    { name: '雷峰塔', address: '杭州市西湖区南山路15号', type: '景点', tel: '0571-87982111', rating: '4.5' },
    { name: '杭州洲际酒店', address: '杭州市上城区解放东路2号', type: '酒店', tel: '0571-89810000', rating: '4.6' },
    { name: '杭州西湖希尔顿', address: '杭州市西湖区教工路195号', type: '酒店', tel: '0571-88088888', rating: '4.5' },
    { name: '杭州万豪酒店', address: '杭州市江干区剧院路399号', type: '酒店', tel: '0571-87218888', rating: '4.7' },
    { name: '楼外楼菜馆', address: '杭州市西湖区孤山路30号', type: '餐厅', tel: '0571-87969023', rating: '4.4' },
    { name: '外婆家（湖滨店）', address: '杭州市上城区湖滨路3号', type: '餐厅', tel: '0571-87172478', rating: '4.3' },
    { name: '新白鹿餐厅', address: '杭州市西湖区文二路328号', type: '餐厅', tel: '0571-88805888', rating: '4.2' },
  ];

  let filtered = allPois;
  if (keyword) {
    filtered = allPois.filter(p =>
      p.name.includes(keyword) || p.address.includes(keyword)
    );
  }
  if (type && type !== '全部') {
    filtered = filtered.filter(p => p.type === type);
  }

  return filtered;
}

/**
 * 模拟攻略
 */
function mockGuides(keyword) {
  const all = [
    { src: '马蜂窝', title: '杭州三天两夜自由行攻略', summary: 'Day1西湖环湖+雷峰塔，Day2灵隐寺+龙井村，Day3西溪湿地+河坊街', tags: ['杭州', '三日游', '经典'] },
    { src: '小红书', title: '杭州本地人私藏小众景点', summary: '避开人潮！九溪十八涧、茅家埠、满觉陇、梅家坞，这才是杭州的正确打开方式', tags: ['杭州', '小众', '本地人'] },
    { src: '穷游', title: '杭州穷游攻略 | ¥500玩转三天', summary: '青旅住宿+公交出行+免费景点+平价美食，学生党友好', tags: ['杭州', '穷游', '省钱'] },
    { src: '携程', title: '杭州夏日避暑旅行路线', summary: '龙井问茶→九溪烟树→云栖竹径，夏日清凉路线推荐', tags: ['杭州', '避暑', '夏季'] },
    { src: '马蜂窝', title: '杭州美食地图 | 杭帮菜必吃清单', summary: '东坡肉、西湖醋鱼、龙井虾仁、片儿川、葱包烩...不踩雷指南', tags: ['杭州', '美食', '探店'] },
  ];

  if (!keyword) return all;
  return all.filter(g =>
    g.title.includes(keyword) || g.summary.includes(keyword) || g.tags.some(t => t.includes(keyword))
  );
}

module.exports = {
  mockForecast,
  mockNow,
  mockPoiList,
  mockGuides
};
