# 悠行 - 出行游玩规划助手

出行游玩规划小程序的全栈原型，包含前端页面和后端API代理服务。

## 功能概览

| 板块 | 功能 |
|------|------|
| 📅 出行日期 | 天气查询、出发/返程时间选择、带宜/不宜标注的日历表 |
| 📍 出行地点 | 住宿/餐饮/景点/古迹/游乐 5 大分类，可检索携程/小红书/高德 |
| 🚗 出行选择 | 9 种出行方式多选 + 大路线(全程)与每日小路线规划 |
| 📋 出行准备 | 6 项准备清单 + 出发前一天20:00提醒 + 智能检查打回机制 |
| 💰 旅行经费 | 模式一：给定金额自动分配；模式二：逐日填写后汇总预估 |
| 📖 攻略检索 | 聚合高德/携程/小红书攻略，按相似度排序 |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 16 或更高版本

### 三步启动

```bash
# 1. 克隆仓库
git clone https://github.com/你的用户名/travel-companion.git
cd travel-companion

# 2. 安装依赖
npm install

# 3. 启动服务
npm start
```

启动后在浏览器打开 **http://localhost:3000** 即可使用。

> Windows 用户也可直接双击 `start.bat` 一键启动。

### 配置 API Key（可选）

不配置任何 Key 也能正常运行，只是天气/地点数据为模拟数据。

```bash
# 复制配置模板
cp .env.example .env
```

编辑 `.env` 文件填入你的 Key：

| Key | 注册地址 | 用途 | 免费配额 |
|-----|---------|------|---------|
| `AMAP_KEY` | [lbs.amap.com](https://lbs.amap.com/) | 地点搜索/路线规划/天气 | 5000次/天 |
| `QWEATHER_KEY` | [dev.qweather.com](https://dev.qweather.com/) | 7天预报/气象预警/生活指数 | 1000次/天 |
| `WX_APPID` / `WX_SECRET` | [mp.weixin.qq.com](https://mp.weixin.qq.com/) | 订阅消息推送(20:00提醒) | — |
| `CTRIP_AID` | [u.ctrip.com](https://u.ctrip.com/) | 携程联盟分销链接(可选) | — |

保存后重启服务即可。

## 项目结构

```
travel-companion/
├── api/
│   └── index.js            # Vercel Serverless Function 入口
├── public/                 # 前端页面 (Vercel 自动作为静态资源)
│   └── index.html          # 单页应用 (所有UI和交互逻辑)
├── src/
│   ├── server.js           # Express 应用 (本地启动 + 被 Vercel 导入)
│   └── routes/
│       ├── amap.js         # 高德地图 API (POI/路线/天气/地理编码)
│       ├── weather.js      # 和风天气 API (预报/预警/生活指数)
│       ├── guides.js       # 攻略聚合 (高德+携程+小红书)
│       └── wechat.js       # 微信能力 (订阅消息/定时提醒/智能检查)
├── .env.example            # 环境变量模板
├── .gitignore
├── package.json
├── start.bat               # Windows 一键启动
├── vercel.json             # Vercel 部署配置
└── README.md
```

## API 接口一览

### 高德地图 (`/api/amap`)

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/api/amap/poi` | keywords, city, types | POI地点搜索 |
| GET | `/api/amap/route` | origin, destination, city, mode | 路线规划(公交/驾车/步行/骑行) |
| GET | `/api/amap/weather` | city | 天气查询 |
| GET | `/api/amap/geocode` | address, city | 地址转经纬度 |

### 和风天气 (`/api/weather`)

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/api/weather/city` | location | 城市查询(获取LocationID) |
| GET | `/api/weather/now` | location | 实时天气 |
| GET | `/api/weather/forecast` | location | 7天预报 |
| GET | `/api/weather/warning` | location | 气象预警 |
| GET | `/api/weather/indices` | location, type | 生活指数(穿衣/紫外线/旅游) |

### 攻略 (`/api/guides`)

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/api/guides/search` | keywords, city | 攻略聚合搜索 |
| POST | `/api/guides/curate` | title, source, summary... | 人工策展录入 |

### 微信 (`/api/wechat`)

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| POST | `/api/wechat/notify` | openid, templateId, data | 发送订阅消息 |
| POST | `/api/wechat/schedule-reminder` | openid, travelDate... | 创建定时提醒 |
| GET | `/api/wechat/check-prep` | travelDate, locationId | 出行准备智能检查 |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 + Key配置状态 |

## 关于携程和小红书 API

**携程和小红书没有面向个人开发者的开放数据 API。** 这是现实，不是技术问题。

| 服务 | 现状 | 替代方案 |
|------|------|---------|
| 携程 | 无公开数据API | 联盟跳转链接 + 高德POI数据替代 |
| 小红书 | 无任何公开API | 人工策展入库 / 第三方付费数据 / 引导跳转 |

本项目的处理方式：
- **酒店/餐厅/景点数据**：用高德POI替代（完全开放）
- **携程**：生成搜索跳转链接
- **小红书**：生成搜索跳转链接 + 提供人工策展接口

## 部署到 Vercel（推荐）

本项目已配置好 Vercel Serverless 部署，只需 3 步：

### 1. 推送代码到 GitHub

```bash
git add -A
git commit -m "适配 Vercel Serverless 部署"
git push origin main
```

### 2. 在 Vercel 导入项目

1. 打开 [vercel.com/new](https://vercel.com/new)
2. 选择你的 GitHub 仓库
3. Framework Preset 选择 **Other**（Vercel 会自动读取 `vercel.json`）
4. 点击 **Deploy**

### 3. 配置环境变量

部署成功后，进入项目 **Settings → Environment Variables**，添加：

| 名称 | 说明 |
|------|------|
| `AMAP_KEY` | 高德地图 Web服务 Key |
| `QWEATHER_KEY` | 和风天气 Web API Key |
| `WX_APPID` | 微信小程序 AppID（可选） |
| `WX_SECRET` | 微信小程序 Secret（可选） |
| `CTRIP_AID` | 携程联盟 AID（可选） |

添加后 Vercel 会自动重新部署。

### 常见问题：500 / FUNCTION_INVOCATION_FAILED

如果部署后出现这个错误，通常是因为：

1. **没有配置 API Key** — 不配置也能运行（会回退到模拟数据），但请检查 Vercel 日志确认具体错误
2. **没有添加 `vercel.json`** — 本仓库已包含，请确认已推送到 GitHub
3. **依赖未安装** — 检查 Vercel Build Logs 是否有 `serverless-http` 安装成功

查看日志路径：Vercel 项目 → **Deployments** → 点击失败的部署 → **Build Logs** / **Function Logs**。

## 部署到服务器

```bash
# 在服务器上
git clone https://github.com/你的用户名/travel-companion.git
cd travel-companion
npm install --production
cp .env.example .env
# 编辑 .env 填入生产环境的Key
npm start
```

建议配合 PM2 进程管理：

```bash
npm install -g pm2
pm2 start src/server.js --name travel-companion
pm2 save
pm2 startup
```

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript (单页应用)
- **外部API**: 高德地图、和风天气、微信小程序
- **缓存**: node-cache (内存缓存)
- **HTTP客户端**: axios

## License

MIT
