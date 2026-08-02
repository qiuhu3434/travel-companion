// 雨筹出行规划 - 出行准备页面
const api = require('../../utils/api');

Page({
  data: {
    checklist: [
      { id: 'idcard',   text: '身份证/护照',     category: '证件', checked: false },
      { id: 'phone',    text: '手机 + 充电宝',   category: '电子', checked: false },
      { id: 'clothes',  text: '换洗衣物（3套）', category: '衣物', checked: false },
      { id: 'toiletry', text: '洗漱用品',         category: '日用', checked: false },
      { id: 'meds',     text: '常备药品',         category: '医药', checked: false },
      { id: 'umbrella', text: '雨伞/防晒',       category: '防护', checked: false }
    ],
    categories: [],
    checkedCount: 0,
    progressPercent: 0,
    newItemText: '',
    quickAdds: ['充电线', '水杯', '防晒霜', '墨镜', '晕车药', '零食'],
    checkResult: null
  },

  onLoad() {
    this.loadFromState();
  },

  onShow() {
    this.loadFromState();
  },

  loadFromState() {
    const state = api.getState();
    this.setData({ checklist: [...state.prep.items] });
    this.refreshUI();
  },

  refreshUI() {
    const checklist = this.data.checklist;
    const checkedCount = checklist.filter(i => i.checked).length;
    const progressPercent = checklist.length > 0 ? Math.round((checkedCount / checklist.length) * 100) : 0;

    // 按分类分组
    const categoryMap = {};
    checklist.forEach(item => {
      if (!categoryMap[item.category]) {
        categoryMap[item.category] = { name: item.category, icon: this.getCategoryIcon(item.category), items: [] };
      }
      categoryMap[item.category].items.push(item);
    });

    this.setData({
      checkedCount,
      progressPercent,
      categories: Object.values(categoryMap)
    });

    // 同步到全局状态
    const state = api.getState();
    state.prep.items = [...checklist];
    getApp().saveState();
  },

  getCategoryIcon(cat) {
    const map = { '证件': '🪪', '电子': '📱', '衣物': '👕', '日用': '🧴', '医药': '💊', '防护': '🛡️' };
    return map[cat] || '📦';
  },

  toggleCheck(e) {
    const id = e.currentTarget.dataset.id;
    const checklist = this.data.checklist.map(item => {
      if (item.id === id) item.checked = !item.checked;
      return item;
    });
    this.setData({ checklist });
    this.refreshUI();
  },

  resetAll() {
    wx.showModal({
      title: '确认重置',
      content: '确定要重置全部勾选状态吗？',
      success: (res) => {
        if (res.confirm) {
          const checklist = this.data.checklist.map(item => ({ ...item, checked: false }));
          this.setData({ checklist, checkResult: null });
          this.refreshUI();
        }
      }
    });
  },

  onNewItemInput(e) {
    this.setData({ newItemText: e.detail.value });
  },

  addCustomItem() {
    const text = this.data.newItemText.trim();
    if (!text) {
      wx.showToast({ title: '请输入物品名称', icon: 'none' });
      return;
    }
    const id = 'custom_' + Date.now();
    const checklist = [...this.data.checklist, { id, text, category: '自定义', checked: false }];
    this.setData({ checklist, newItemText: '' });
    this.refreshUI();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  quickAdd(e) {
    const text = e.currentTarget.dataset.text;
    const id = 'quick_' + Date.now();
    const checklist = [...this.data.checklist, { id, text, category: '自定义', checked: true }];
    this.setData({ checklist });
    this.refreshUI();
    wx.showToast({ title: '已添加并勾选', icon: 'success' });
  },

  async runSystemCheck() {
    wx.showLoading({ title: '检查中...' });
    const issues = [];
    let apiChecked = false;

    // 1. 检查清单完成度
    const unchecked = this.data.checklist.filter(i => !i.checked);
    if (unchecked.length > 0) {
      issues.push({
        level: 'warning',
        msg: `还有 ${unchecked.length} 项未准备：${unchecked.map(i => i.text).join('、')}`
      });
    }

    // 2. 调用天气API检查预报
    const state = api.getState();
    try {
      const cityRes = await api.request('/api/weather/city', { location: state.city });
      if (cityRes && cityRes.data && cityRes.data[0]) {
        const warnRes = await api.request('/api/weather/warning', { location: cityRes.data[0].id });
        if (warnRes && warnRes.data && warnRes.data.length > 0) {
          warnRes.data.forEach(w => {
            issues.push({
              level: 'danger',
              msg: `⚠️ ${state.city}：${w.title} - ${w.text}`
            });
          });
          apiChecked = true;
        } else {
          apiChecked = true;
        }
      }
    } catch (e) {
      console.warn('天气检查失败:', e);
    }

    wx.hideLoading();

    const allPassed = issues.length === 0;
    this.setData({
      checkResult: { allPassed, issues, apiChecked }
    });

    if (allPassed) {
      wx.showToast({ title: '检查通过！', icon: 'success' });
    } else {
      wx.showToast({ title: `发现${issues.length}个问题`, icon: 'warning' });
    }
  }
});
