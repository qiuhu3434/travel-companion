// 悠行 - 旅行经费页面
const api = require('../../utils/api');

const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#64748b'];

// 默认分配比例
const AUTO_RATIOS = [0.20, 0.30, 0.20, 0.15, 0.10, 0.05];

Page({
  data: {
    mode: 'auto',
    totalBudget: '3000',
    budgetItems: [],
    totalAllocated: 0
  },

  onLoad() {
    const state = api.getState();
    const items = state.budget.items.map((item, i) => ({
      ...item,
      percent: 0,
      spentPercent: 0,
      color: COLORS[i]
    }));
    const totalAllocated = items.reduce((s, i) => s + i.amount, 0);
    items.forEach(item => {
      item.percent = totalAllocated > 0 ? Math.round((item.amount / totalAllocated) * 100) : 0;
      item.spentPercent = item.amount > 0 ? Math.round((item.spent / item.amount) * 100) : 0;
      if (item.spentPercent > 100) item.spentPercent = 100;
    });

    this.setData({
      mode: state.budget.mode || 'auto',
      totalBudget: String(state.budget.total || 3000),
      budgetItems: items,
      totalAllocated
    });
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  onTotalInput(e) {
    this.setData({ totalBudget: e.detail.value });
    // 实时重新分配
    this.autoAllocate();
  },

  autoAllocate() {
    const total = parseFloat(this.data.totalBudget) || 3000;
    const items = this.data.budgetItems.map((item, i) => {
      const amount = Math.round(total * AUTO_RATIOS[i]);
      return { ...item, amount, spent: item.spent };
    });
    
    const totalAllocated = items.reduce((s, i) => s + i.amount, 0);
    items.forEach(item => {
      item.percent = totalAllocated > 0 ? Math.round((item.amount / totalAllocated) * 100) : 0;
      item.spentPercent = item.amount > 0 ? Math.round((item.spent / item.amount) * 100) : 0;
      if (item.spentPercent > 100) item.spentPercent = 100;
    });

    this.setData({ budgetItems: items, totalAllocated });

    // 保存
    const state = api.getState();
    state.budget.total = total;
    state.budget.mode = 'auto';
    state.budget.items = items.map(i => ({ name: i.name, amount: i.amount, spent: i.spent }));
    getApp().saveState();
  },

  onManualInput(e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const val = parseFloat(e.detail.value) || 0;
    const items = [...this.data.budgetItems];
    items[index] = { ...items[index], amount: val };

    const totalAllocated = items.reduce((s, i) => s + i.amount, 0);
    items.forEach(item => {
      item.percent = totalAllocated > 0 ? Math.round((item.amount / totalAllocated) * 100) : 0;
      item.spentPercent = item.amount > 0 ? Math.round((item.spent / item.amount) * 100) : 0;
      if (item.spentPercent > 100) item.spentPercent = 100;
    });

    this.setData({ budgetItems: items, totalAllocated });

    const state = api.getState();
    state.budget.mode = 'manual';
    state.budget.items = items.map(i => ({ name: i.name, amount: i.amount, spent: i.spent }));
    getApp().saveState();
  }
});
