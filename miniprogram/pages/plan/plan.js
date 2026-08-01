// 悠行 - 智能规划（三列表推荐 + 整合规划）
const api = require('../../utils/api');

Page({
  data: {
    city: '',
    days: 3,
    dayIndex: 2,
    dayOptions: ['1天', '2天', '3天', '4天', '5天', '6天', '7天'],
    budget: 0,
    budgetText: '',
    loading: false,
    recommendations: null,
    selections: { food: [], outdoor: [], culture: [] },
    activeTab: 'food',
    currentItems: [],
    selCount: 0,
    result: null,
  },

  onLoad() {
    const app = getApp();
    if (app.globalData && app.globalData.city) {
      this.setData({ city: app.globalData.city });
    }
  },

  onCityInput(e) {
    this.setData({ city: e.detail.value });
  },

  onDayChange(e) {
    this.setData({
      dayIndex: parseInt(e.detail.value),
      days: parseInt(e.detail.value) + 1,
    });
  },

  onBudgetInput(e) {
    const v = e.detail.value;
    this.setData({ budgetText: v, budget: parseInt(v) || 0 });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.updateCurrentItems(tab);
    this.setData({ activeTab: tab });
  },

  updateCurrentItems(tab) {
    const rec = this.data.recommendations;
    if (!rec) return;
    const items = (rec[tab] || []).map(item => ({
      ...item,
      _checked: this.data.selections[tab].includes(item.id),
    }));
    this.setData({ currentItems: items });
  },

  toggleItem(e) {
    const id = e.currentTarget.dataset.id;
    const cat = this.data.activeTab;
    const sel = { ...this.data.selections };
    // deep copy the array
    sel[cat] = [...sel[cat]];
    const idx = sel[cat].indexOf(id);
    if (idx >= 0) {
      sel[cat].splice(idx, 1);
    } else {
      sel[cat].push(id);
    }

    const selCount = sel.food.length + sel.outdoor.length + sel.culture.length;
    this.setData({ selections: sel, selCount });
    this.updateCurrentItems(cat);
  },

  async fetchRecommendations() {
    const city = this.data.city.trim();
    if (!city) {
      wx.showToast({ title: '请输入目的地', icon: 'none' });
      return;
    }

    this.setData({
      loading: true,
      result: null,
      selections: { food: [], outdoor: [], culture: [] },
      selCount: 0,
      activeTab: 'food',
    });
    wx.showLoading({ title: '获取推荐中...', mask: true });

    try {
      const result = await api.post('/api/plan/recommend', { city });
      if (result) {
        this.setData({ recommendations: result });
        this.updateCurrentItems('food');
      } else {
        wx.showToast({ title: '获取推荐失败，请检查API配置', icon: 'none' });
      }
    } catch (e) {
      console.error('[Plan] 获取推荐失败:', e);
      wx.showToast({ title: '获取推荐失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  async generatePlan() {
    const { city, days, budget, recommendations, selections } = this.data;

    if (!city.trim()) {
      wx.showToast({ title: '请输入目的地', icon: 'none' });
      return;
    }

    // 收集勾选的地点名称
    const req = { food: [], outdoor: [], culture: [] };
    const rec = recommendations || {};
    for (const cat of ['food', 'outdoor', 'culture']) {
      req[cat] = (selections[cat] || [])
        .map(id => {
          const item = (rec[cat] || []).find(it => it.id === id);
          return item ? item.name : null;
        })
        .filter(Boolean);
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '规划中...', mask: true });

    try {
      const result = await api.post('/api/plan/generate', {
        city: city.trim(),
        days,
        budget: budget || null,
        selections: req,
      });

      if (result) {
        const app = getApp();
        if (app.globalData) app.globalData.city = city.trim();
        this.setData({ result });
      } else {
        this.setData({
          result: this.buildFallback(city.trim(), days, req),
        });
      }
    } catch (e) {
      console.error('[Plan] 生成失败:', e);
      this.setData({
        result: this.buildFallback(city.trim(), days, req, '错误恢复模板'),
      });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  buildFallback(city, days, selections, source) {
    const selFood = selections.food || [];
    const selOutdoor = selections.outdoor || [];
    const selCulture = selections.culture || [];

    const defaultRests = [
      { name: city + '地道菜馆', cost: 60 },
      { name: city + '老字号餐厅', cost: 80 },
      { name: city + '特色小吃', cost: 30 },
      { name: city + '网红餐厅', cost: 100 },
      { name: city + '本地火锅', cost: 90 },
      { name: city + '农家菜', cost: 50 },
    ];

    const allAttr = [...selOutdoor, ...selCulture];
    if (allAttr.length === 0) allAttr.push(city + '市中心', city + '商业街', city + '公园');

    const daily = [];
    for (let d = 0; d < days; d++) {
      const spots = [
        { slot: 'breakfast', time: '08:00-09:00', label: '早餐', icon: '🍳', poi: { name: '酒店早餐/当地早餐店', address: '' } },
        { slot: 'morning1', time: '09:00-10:30', label: '上午景点①', icon: '🏛️', poi: { name: allAttr[d * 2 % allAttr.length], address: '' } },
        { slot: 'morning2', time: '10:30-12:00', label: '上午景点②', icon: '📍', poi: { name: allAttr[(d * 2 + 1) % allAttr.length], address: '' } },
        { slot: 'lunch', time: '12:00-13:30', label: '午餐', icon: '🍽️', poi: { name: selFood[d % selFood.length] || defaultRests[d % 6].name, address: '' }, isMeal: true },
        { slot: 'afternoon1', time: '13:30-15:30', label: '下午景点①', icon: '🎯', poi: { name: allAttr[(d * 2 + 2) % allAttr.length], address: '' } },
        { slot: 'afternoon2', time: '15:30-17:30', label: '下午景点②', icon: '📸', poi: { name: allAttr[(d * 2 + 3) % allAttr.length], address: '' } },
        { slot: 'dinner', time: '17:30-19:00', label: '晚餐', icon: '🥘', poi: { name: selFood[(d + 1) % selFood.length] || defaultRests[(d + 3) % 6].name, address: '' }, isMeal: true },
        { slot: 'evening', time: '19:00-21:00', label: '晚间活动', icon: '🌙', poi: { name: '自由探索/散步', address: '' } },
      ];
      daily.push({ day: d + 1, date: '第' + (d + 1) + '天', schedule: spots, connections: [] });
    }

    return {
      city, days,
      source: source || '离线模板（后端未连接）',
      weatherAvailable: false,
      selections: { food: [], outdoor: [], culture: [] },
      daily,
    };
  },
});
