// 悠行 - 交通选择页面
const api = require('../../utils/api');

// 9种交通方式定义
const TRANSPORTS = [
  { id: 'walk',     name: '步行',    icon: '🚶', speed: '慢',   cost: '免费',     cap: '1',  pros: ['零成本','灵活','锻炼'],                   cons: ['不适合远途','耗体力'] },
  { id: 'bike',     name: '自行车',  icon: '🚲', speed: '中',   cost: '¥1.5/小时', cap: '1',  pros: ['环保','灵活','锻炼'],                      cons: ['受天气影响','不宜远途'] },
  { id: 'bus',      name: '公交车',  icon: '🚌', speed: '中',   cost: '¥2-5',     cap: '大', pros: ['便宜','覆盖面广'],                           cons: ['拥挤','不准时'] },
  { id: 'subway',   name: '地铁',    icon: '🚇', speed: '快',   cost: '¥3-10',    cap: '大', pros: ['准时','快速','不堵车'],                      cons: ['高峰期拥挤','覆盖有限'] },
  { id: 'taxi',     name: '出租车',  icon: '🚕', speed: '快',   cost: '¥30-200',  cap: '4',  pros: ['点对点','舒适'],                             cons: ['贵','高峰期难打'] },
  { id: 'selfdrive',name: '自驾',    icon: '🚗', speed: '中',   cost: '¥100-500', cap: '5',  pros: ['自由','携带物品方便'],                       cons: ['停车难','高速费','疲劳驾驶'] },
  { id: 'highspeed',name: '高铁',    icon: '🚄', speed: '很快', cost: '¥50-500',  cap: '大', pros: ['快','舒适','准时'],                           cons: ['需提前购票','受天气影响小但存在'] },
  { id: 'train',    name: '火车',    icon: '🚂', speed: '中',   cost: '¥30-300',  cap: '大', pros: ['价格适中','风景好'],                         cons: ['慢','晚点'] },
  { id: 'plane',    name: '飞机',    icon: '✈️', speed: '最快', cost: '¥300-2000',cap: '大', pros: ['远距离最快','舒适'],                           cons: ['贵','机场远','安检耗时'] }
];

Page({
  data: {
    city: '杭州',
    transportList: TRANSPORTS,
    selectedId: null,
    selected: null,
    routes: []
  },

  onLoad() {
    const state = api.getState();
    this.setData({ city: state.city });
    if (state.transport && state.transport.selected) {
      this.setData({ selectedId: state.transport.selected });
      this.showDetail(state.transport.selected);
    }
  },

  onShow() {
    const state = api.getState();
    if (state.city !== this.data.city) {
      this.setData({ city: state.city });
    }
  },

  selectTransport(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedId: id });
    
    const state = api.getState();
    state.transport.selected = id;
    getApp().saveState();

    this.showDetail(id);
  },

  showDetail(id) {
    const t = TRANSPORTS.find(t => t.id === id);
    if (!t) return;

    this.setData({
      selected: t,
      routes: this.generateRoutes(t)
    });
  },

  generateRoutes(transport) {
    // 模拟路线数据
    const now = new Date();
    const routes = [];
    const count = transport.id === 'walk' || transport.id === 'bike' ? 1 : 4;

    for (let i = 0; i < count; i++) {
      const h = (8 + i * 2) % 24;
      const m = i * 15 % 60;
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      let info = '';
      switch (transport.id) {
        case 'walk':    info = '步行约45分钟，沿途可赏景'; break;
        case 'bike':    info = '骑行约20分钟，推荐骑行道'; break;
        case 'bus':     info = `公交K${i+1}路，约${30+i*10}分钟`; break;
        case 'subway':  info = `地铁${i+1}号线，约${20+i*5}分钟`; break;
        case 'taxi':    info = `约${15+i*5}分钟，预计¥${25+i*10}`; break;
        case 'selfdrive': info = `约${25+i*5}分钟，高速费¥${10+i*5}`; break;
        case 'highspeed': info = `G${1000+i}次，约${60+i*30}分钟`; break;
        case 'train':   info = `K${800+i}次，约${120+i*30}分钟`; break;
        case 'plane':   info = `CA${3000+i}次，约${90+i*30}分钟`; break;
      }
      routes.push({ time, info });
    }
    return routes;
  }
});
