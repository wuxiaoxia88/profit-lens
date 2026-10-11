# 盈亏透镜 ProfitLens

**快递网点客户发件盈亏分析与报价决策工具。** 把「网点发件盈亏分析 - 单号明细」导出文件拖进浏览器，几秒钟看清：

- 🧾 **客户报价是怎么定的、对不对**：自动从运费反推「分区 × 重量段」报价表和续重公式，识别调价日；上传正式报价后逐单核对多收、少收。
- 🗺️ **哪些流向、哪些重量段在赚钱/亏钱**：省份 × 重量段利润热力图、0.1kg 精细利润曲线、流向象限图。
- 📊 **客户的货是什么结构**：重量分位数、重量段占比、省份瓦片地图、大区与店铺占比。
- 💰 **真实纯利**：醒目提示「系统利润只是毛利」，自定义线下操作管理成本后全站显示纯利。
- 🧮 **调价会怎样**：改价即时测算利润变化，按成本 + 目标利润给出参考报价。
- 🖨️ **一键分享**：高清 PNG、A4 PDF 报告，匿名模式隐藏客户信息。

> 🔒 数据只在本机浏览器里计算，**不上传任何服务器**。百万行数据约 3 秒导入。

## 怎么用

| 方式 | 适合 | 步骤 |
| --- | --- | --- |
| **在线版** | 有网络、想最快开始 | 打开 <https://wuxiaoxia88.github.io/profit-lens/> |
| **离线单文件** | 内网、分享给同事 | 在 [Releases](https://github.com/wuxiaoxia88/profit-lens/releases) 下载 `ProfitLens.html`，双击用浏览器打开 |

Windows / Mac 均可，推荐 Chrome、Edge 或 Safari 最新版。没有数据时可点「先用示例数据看看」（示例数据为虚构）。

完整说明见 **[使用手册](docs/使用手册.md)**（应用内「使用帮助」页签也能看到）。

## 数据要求

- 推荐：盈亏分析系统导出的单号明细原表（26 列，xlsx）。
- 最少：「目的地」+「结算重量」两列即可做流向和重量段结构分析；有收入、成本、利润列则解锁利润分析与报价核对。
- 表头不一致时，导入时会弹出字段对应窗口。

## 开发

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
npm test           # 单元测试
npm run build      # 构建单文件 dist/index.html
npm run release    # 生成 release/ProfitLens.html
```

技术栈：React + TypeScript + Vite + ECharts（SVG 渲染）。解析层为自研流式 XLSX/CSV 解析器（原生 DecompressionStream + 逐字节扫描），列式 TypedArray 存储。架构、算法与路线图见 [docs/PLAN.md](docs/PLAN.md)。

```
src/
  engine/        纯计算，可单测：解析、数据集、筛选聚合、报价还原/核对/模拟、指标口径
  app/           状态、Worker 桥接、导出、主题
  components/    卡片、图表、角标、筛选条、瓦片地图
  pages/         各页签
docs/            规划与使用手册
tests/           单元测试（tests/real-data.local.ts 用本机真实数据冒烟，数据不入库）
```

**隐私约定**：真实客户数据只放 `local-data/`（已被 .gitignore 屏蔽），任何真实客户名称、账号、价格都不得提交到仓库。

## 发布

1. 更新 `package.json` 版本号与 `CHANGELOG.md`；
2. `git tag v0.x.y && git push --tags`，GitHub Actions 自动构建并发布 Release（附 `ProfitLens.html`）；
3. 推送 `main` 会自动更新在线版。

## 许可

[MIT](LICENSE)
