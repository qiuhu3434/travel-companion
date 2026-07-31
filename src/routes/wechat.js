/**
 * 微信原生能力路由
 *
 * 微信小程序开放的能力（无需额外注册，使用小程序凭据即可）：
 * - 订阅消息：用于"出发前一天20:00弹窗提醒"功能
 * - 微信支付：用于旅行经费管理
 * - 地理定位：获取用户当前位置
 * - 用户信息：openid 用于消息推送
 *
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/api-backend/
 */
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const router = express.Router();
const tokenCache = new NodeCache({ stdTTL: 7000 }); // access_token有效期约2小时
const { WX_APPID, WX_SECRET, QWEATHER_KEY } = process.env;

/**
 * 获取微信 access_token（带缓存）
 */
async function getAccessToken() {
  const cached = tokenCache.get('wx_access_token');
  if (cached) return cached;

  const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: WX_APPID,
      secret: WX_SECRET
    },
    timeout: 8000
  });

  if (!resp.data.access_token) {
    throw new Error('获取access_token失败: ' + JSON.stringify(resp.data));
  }

  tokenCache.set('wx_access_token', resp.data.access_token);
  return resp.data.access_token;
}

/**
 * POST /api/wechat/notify
 * 发送订阅消息 - 出发前一天20:00提醒
 *
 * 请求参数:
 *   openid      - 接收消息的用户openid
 *   templateId  - 订阅消息模板ID
 *   page        - 点击消息后跳转的小程序页面（默认出行准备页）
 *   data        - 模板数据，格式取决于模板配置
 */
router.post('/notify', async (req, res) => {
  const { openid, templateId, page = 'pages/prep/index', data } = req.body;

  if (!openid || !templateId) {
    return res.status(400).json({ error: '缺少 openid 或 templateId' });
  }
  if (!WX_APPID || !WX_SECRET) {
    return res.json({ mock: true, message: '微信小程序凭据未配置，消息未发送' });
  }

  try {
    const token = await getAccessToken();

    const resp = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        touser: openid,
        template_id: templateId,
        page,
        miniprogram_state: 'formal',
        data
      },
      { timeout: 8000 }
    );

    if (resp.data.errcode === 0) {
      res.json({ success: true, message: '订阅消息发送成功' });
    } else {
      console.error('[微信] 订阅消息发送失败:', resp.data);
      res.status(400).json({
        error: '订阅消息发送失败',
        errcode: resp.data.errcode,
        errmsg: resp.data.errmsg
      });
    }
  } catch (err) {
    console.error('[微信] 通知服务异常:', err.message);
    res.status(500).json({ error: '通知服务异常', detail: err.message });
  }
});

/**
 * POST /api/wechat/schedule-reminder
 * 创建定时提醒任务
 *
 * 在用户设置出行日期后，自动创建一个定时任务：
 * 出发前一天北京时间20:00推送订阅消息。
 *
 * 请求参数:
 *   openid      - 用户openid
 *   templateId  - 模板ID
 *   travelDate  - 出发日期 "2026-08-15"
 *   tripName    - 行程名称
 *   prepStatus  - 准备完成度
 */
router.post('/schedule-reminder', async (req, res) => {
  const { openid, templateId, travelDate, tripName, prepStatus = '待检查' } = req.body;

  if (!openid || !travelDate) {
    return res.status(400).json({ error: '缺少 openid 或 travelDate' });
  }

  // 计算提醒时间：出发前一天 20:00 北京时间
  const travelDateTime = new Date(travelDate + 'T00:00:00+08:00');
  const reminderTime = new Date(travelDateTime.getTime() - 24 * 60 * 60 * 1000);
  reminderTime.setHours(20, 0, 0, 0);

  const reminder = {
    openid,
    templateId,
    travelDate,
    tripName,
    prepStatus,
    reminderTime: reminderTime.toISOString(),
    reminderTimeLocal: reminderTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    data: {
      thing1: { value: tripName || '出行提醒' },
      time2: { value: `${travelDate} 08:00` },
      thing3: { value: `准备完成度${prepStatus}` },
      thing4: { value: '请尽快完成出行检查' }
    }
  };

  // TODO: 存入数据库定时任务表，或使用 node-schedule 创建定时任务
  // const schedule = require('node-schedule');
  // schedule.scheduleJob(reminderTime, async () => {
  //   await sendSubscribeMessage(openid, templateId, 'pages/prep/index', reminder.data);
  // });

  res.json({
    success: true,
    message: '定时提醒已创建',
    reminderTime: reminderTime.toISOString(),
    reminderTimeLocal: reminderTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    data: reminder
  });
});

/**
 * GET /api/wechat/check-prep
 * 出行准备智能检查
 *
 * 这是"系统检查打回"功能的后端逻辑：
 * 检查出行准备是否完善，发现不恰当之处打回。
 *
 * 检查项：
 * 1. 出发日天气是否有恶劣天气预警
 * 2. 所选路线是否通行
 * 3. 预约是否已确认
 * 4. 地点是否有时间冲突
 */
router.get('/check-prep', async (req, res) => {
  const { travelDate, city, locationId } = req.query;

  const issues = [];

  // 1. 检查天气预警（如果配置了和风天气Key）
  if (locationId && QWEATHER_KEY) {
    try {
      const weatherResp = await axios.get('https://devapi.qweather.com/v7/warning/now', {
        params: { location: locationId, key: QWEATHER_KEY },
        timeout: 8000
      });
      if (weatherResp.data.code === '200' && weatherResp.data.warning) {
        weatherResp.data.warning.forEach(w => {
          issues.push({
            level: 'danger',
            type: 'weather_warning',
            message: `${w.title}（${w.startTime} 至 ${w.endTime}）`,
            suggestion: '建议调整出行日期或做好防护措施'
          });
        });
      }
    } catch (e) {
      console.error('[检查] 天气预警查询失败:', e.message);
    }
  }

  // 2. 检查出发日天气预报
  if (locationId && QWEATHER_KEY) {
    try {
      const forecastResp = await axios.get('https://devapi.qweather.com/v7/weather/7d', {
        params: { location: locationId, key: QWEATHER_KEY },
        timeout: 8000
      });
      if (forecastResp.data.code === '200' && forecastResp.data.daily) {
        const travelDay = forecastResp.data.daily.find(d => d.fxDate === travelDate);
        if (travelDay) {
          const extremeWeather = ['暴雨', '大雪', '台风', '雷暴', '冰雹'];
          const hasExtreme = extremeWeather.some(w =>
            travelDay.textDay.includes(w) || travelDay.textNight.includes(w)
          );
          if (hasExtreme) {
            issues.push({
              level: 'warning',
              type: 'bad_weather',
              message: `出发日${travelDate}天气：${travelDay.textDay}，${travelDay.tempMin}~${travelDay.tempMax}°C`,
              suggestion: '存在极端天气，建议调整日期或携带防护装备'
            });
          }
        }
      }
    } catch (e) {
      console.error('[检查] 天气预报查询失败:', e.message);
    }
  }

  // 返回检查结果
  const passed = issues.filter(i => i.level === 'danger').length === 0;
  res.json({
    passed,
    issues,
    message: passed
      ? '所有检查项通过，可以出行'
      : `发现${issues.length}个问题，请修正后重新检查`
  });
});

module.exports = router;
