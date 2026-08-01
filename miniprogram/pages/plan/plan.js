// 悠行 - 智能规划页面
const api = require('../../utils/api');
const mock = require('../../utils/mock');

Page({
  data: {
    city: '',
    days: 3,
    dayIndex: 2, // picker index for 3-day
    dayOptions: ['1天', '2天', '3天', '4天', '5天', '6天', '7天'],
    budget: 0,
    budgetText: '',
    preference: 'outdoor',
    loading: false,
    result: null,
  },

  onLoad() {
    const app = getApp();
    if (app.globalData && app.globalData.city) {
      this.setData({ city: app.globalData.city });
    }
  },

  selectPref(e) {
    this.setData({ preference: e.currentTarget.dataset.pref });
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
    this.setData({
      budgetText: v,
      budget: parseInt(v) || 0,
    });
  },

  async generatePlan() {
    const { city, days, preference, budget } = this.data;

    if (!city.trim()) {
      wx.showToast({ title: '请输入目的地', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '规划中...', mask: true });

    try {
      const result = await api.post('/api/plan/generate', {
        city: city.trim(),
        days,
        preference,
        budget: budget || null,
      });

      if (result) {
        // 保存城市到全局
        const app = getApp();
        if (app.globalData) app.globalData.city = city.trim();

        this.setData({ result });
      } else {
        // 后端不可用 → 降级模板
        this.setData({
          result: this.buildFallbackResult(city.trim(), days, preference),
        });
      }
    } catch (e) {
      console.error('[Plan] 生成失败:', e);
      this.setData({
        result: this.buildFallbackResult(city.trim(), days, preference, '错误恢复模板'),
      });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  // 本地降级模板（与后端 generateFallbackPlan 逻辑一致）
  buildFallbackResult(city, days, preference, source) {
    const prefLabels = {
      foodie: '逛吃之旅',
      culture: '人文之旅',
      outdoor: '户外之旅',
    };

    const templates = {
      foodie: {
        morning: [`${city}老街`, `${city}特色早市`, `${city}小吃一条街`],
        afternoon: [`${city}美食博物馆`, `${city}网红打卡街`],
        evening: [`${city}夜市`, `${city}酒吧街`],
        restaurants: [`${city}地道菜馆`, `${city}老字号餐厅`, `${city}热门火锅店`],
      },
      culture: {
        morning: [`${city}博物馆`, `${city}历史街区`, `${city}古城墙`],
        afternoon: [`${city}名人故居`, `${city}艺术馆`, `${city}图书馆`],
        evening: [`${city}剧院`, `${city}老街夜景`],
        restaurants: [`${city}文化餐厅`, `${city}主题餐吧`, `${city}茶馆`],
      },
      outdoor: {
        morning: [`${city}国家公园`, `${city}登山步道`, `${city}湖畔`],
        afternoon: [`${city}植物园`, `${city}湿地公园`, `${city}观景台`],
        evening: [`${city}日落观景点`, `${city}滨江步道`],
        restaurants: [`${city}农家乐`, `${city}户外烧烤`, `${city}湖边餐厅`],
      },
    };

    const t = templates[preference] || templates.outdoor;
    const daily = [];

    for (let d = 0; d < days; d++) {
      const spots = [
        { slot: 'morning1', time: '09:00-10:30', label: '上午景点①', icon: '🏛️', poi: { name: t.morning[d % t.morning.length], address: '' }, tip: null },
        { slot: 'morning2', time: '10:30-12:00', label: '上午景点②', icon: '📍', poi: { name: t.afternoon[d % t.afternoon.length], address: '' }, tip: null },
        { slot: 'lunch', time: '12:00-13:30', label: '午餐', icon: '🍽️', poi: { name: t.restaurants[d % t.restaurants.length], address: '' }, tip: null },
        { slot: 'afternoon1', time: '13:30-15:30', label: '下午景点①', icon: '🎯', poi: { name: t.afternoon[(d + 1) % t.afternoon.length], address: '' }, tip: null },
        { slot: 'afternoon2', time: '15:30-17:30', label: '下午景点②', icon: '📸', poi: { name: t.morning[(d + 1) % t.morning.length], address: '' }, tip: null },
        { slot: 'dinner', time: '17:30-19:00', label: '晚餐', icon: '🥘', poi: { name: t.restaurants[(d + 1) % t.restaurants.length], address: '' }, tip: null },
        { slot: 'evening', time: '19:00-21:00', label: '晚间活动', icon: '🌙', poi: { name: t.evening[d % t.evening.length], address: '' }, tip: null },
      ];
      daily.push({ day: d + 1, date: `第${d + 1}天`, schedule: spots });
    }

    return {
      city,
      days,
      preference,
      preferenceLabel: prefLabels[preference],
      source: source || '离线模板（后端未连接）',
      weatherAvailable: false,
      daily,
    };
  },
});
