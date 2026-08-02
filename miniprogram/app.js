// 雨筹出行规划 - WeChat Mini Program
App({
  onLaunch() {
    // 读取本地缓存的状态
    const cached = wx.getStorageSync('trip_state');
    if (cached) {
      this.globalData.state = cached;
    }
  },

  globalData: {
    // API 后端地址（开发阶段用 Vercel，上架前需改为国内域名）
    apiBase: 'https://travel-companion-gezk.vercel.app',

    // 全局状态（对应 Web 版的 state 对象）
    state: {
      city: '杭州',
      date: {
        start: '2026-08-03',
        end: '2026-08-06',
        weather: { temp: 32, desc: '晴', wind: '东南风3级', humidity: '65%' },
        weatherLoaded: false
      },
      budget: {
        mode: 'auto',
        total: 3000,
        items: [
          { name: '交通', amount: 600, spent: 0 },
          { name: '住宿', amount: 900, spent: 0 },
          { name: '餐饮', amount: 600, spent: 0 },
          { name: '门票', amount: 500, spent: 0 },
          { name: '购物', amount: 300, spent: 0 },
          { name: '其他', amount: 100, spent: 0 }
        ]
      },
      transport: { selected: null },
      prep: {
        items: [
          { id: 'idcard', text: '身份证/护照', category: '证件', checked: false },
          { id: 'phone', text: '手机 + 充电宝', category: '电子', checked: false },
          { id: 'clothes', text: '换洗衣物（3套）', category: '衣物', checked: false },
          { id: 'toiletry', text: '洗漱用品', category: '日用', checked: false },
          { id: 'meds', text: '常备药品', category: '医药', checked: false },
          { id: 'umbrella', text: '雨伞/防晒', category: '防护', checked: false }
        ]
      },
      selectedPoi: null
    },

    // 数据来源标记（mock / live）
    dataSource: { weather: 'mock', poi: 'mock', guides: 'mock', check: 'mock' }
  },

  // 持久化状态到本地
  saveState() {
    try {
      wx.setStorageSync('trip_state', this.globalData.state);
    } catch (e) {
      console.warn('保存状态失败:', e);
    }
  }
});
