# AWS Builder ID Account Tool

> AWS Builder ID 账号自动化管理工具，支持自动注册与账号切换

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)](https://www.typescriptlang.org/)

## 特性

### 自动注册
- Playwright 自动化浏览器注册
- 临时邮箱自动获取验证码：支持 Cloudflare Temp Email 和 GPTMail
- 注册成功后自动发布授权到 kiro.rs
- 可选检测 Kiro PRO 试用资格：只判断 checkout 金额是否为 0，不提交付款（参考 `/Users/leon.zhao/Project/kiro-pro-auto/` 订阅模块）
- 不会本地保存 refreshToken/clientSecret
- 浏览器指纹伪装
- 支持批量注册
- 反检测机制（行为模拟、输入延迟）

### 账号切换
- 交互式菜单操作
- 快速切换 Kiro IDE 账号
- 机器码重置功能
- 自动管理 Kiro 进程

## 快速开始

```bash
# 克隆项目
git clone https://github.com/AERT-7Y/kiro-auto.git
cd kiro-auto

# 安装依赖
npm install

# 安装浏览器
npm run install-browser

# 启动自动注册（默认前台显示、并发 1、注册 3 个）
npm run register

# 如需后台运行
npm run register -- --headless

# 或启动账号切换
npm run switch
```

## 环境要求

| 要求 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18.0.0 | JavaScript 运行时 |
| npm | >= 9.x | 包管理器 |

## 使用方法

### 自动注册

```bash
# 注册单个账号
npm run register -- --count 1

# 非交互模式
npm run register -- --count 1 --non-interactive

# 可视化浏览器窗口
npm run register -- --count 1 --show-browser --non-interactive

# 注册多个账号
npm run register -- --count 10

# 指定并发数
npm run register -- --count 10 --concurrency 3

# 指定注册间隔
npm run register -- --count 5 --delayMs 5000

# 使用代理
npm run register -- --count 5 --proxy "http://127.0.0.1:7890"

# 自测当前临时邮箱渠道配置
npm run register -- --test-mail

# 默认会发布到 kiro.rs；如需临时关闭
npm run register -- --count 1 --no-publish-kiro-rs

# 注册成功后检测 PRO 试用资格，只走到金额是否为 0 的判断；开启后暂不发布 kiro.rs
npm run register -- --count 1 --auto-pro-trial
```

### 账号切换

```bash
npm run switch
```

交互菜单功能：
- 切换账号
- 重启 Kiro
- 重置机器码
- 查看状态

## 命令行参数

| 参数 | 简写 | 默认值 | 说明 |
|------|------|--------|------|
| `--count` | `-n` | 3 | 注册账号数量 |
| `--concurrency` | `-c` | 1 | 并发注册数 |
| `--delayMs` / `--delay` | `-d` | 0 | 注册间隔（毫秒） |
| `--proxy` / `--proxyUrl` | - | 空 | 代理服务器地址 |
| `--non-interactive` | `-y` | 交互菜单 | 非交互运行 |
| `--show-browser` / `--headed` | - | 默认 | 前台显示浏览器 |
| `--headless` | - | 关闭 | 后台运行浏览器 |
| `--test-mail` | - | 关闭 | 只测试当前临时邮箱渠道创建邮箱 |
| `--no-publish-kiro-rs` | - | 自动发布 | 临时关闭 kiro.rs 自动发布 |
| `--auto-pro-trial` / `--check-pro-trial` | - | 关闭 | 注册成功后检测 Kiro PRO 试用资格，只判断金额是否为 0；开启后流程停在检测结果，不付款、不发布 kiro.rs |
| `--no-auto-pro-trial` | - | - | 临时关闭 env 中开启的 PRO 试用资格检测 |
| `--pro-txt-dir` | - | `KIRO_PRO_TXT_DIR` 或 `txt` | PRO 检测账号兜底目录；注册后检测会直接用刚注册的账号 |
| `--pro-profile` | - | `.browser-profile/kiro-pro-trial` | PRO 检测专用浏览器 profile |
| `--pro-reuse-profile` | - | 关闭 | PRO 检测复用已有 Kiro 登录态 |
| `--pro-output` | - | `show/pro-trial-result.json` | PRO 检测结果 JSON |
| `--pro-events` | - | `artifacts/pro-trial-events.ndjson` | PRO 检测事件日志 |
| `--kiro-rs-url` | - | `KIRO_RS_ADMIN_URL` | 覆盖 kiro.rs admin 地址 |
| `--kiro-rs-key` | - | `KIRO_RS_ADMIN_KEY` | 覆盖 kiro.rs API Key |
| `--priority` | - | `KIRO_RS_PRIORITY` 或 0 | 上传到 kiro.rs 的凭据优先级 |
| `--no-fingerprint` | - | 开启 | 禁用指纹伪装 |
| `--no-incognito` | - | 开启 | 禁用无痕模式 |


## 环境变量配置

先复制模板：

```bash
cp .env.example .env
```

常用配置：

| 变量 | 说明 |
|------|------|
| `KIRO_RS_UPLOAD_ENABLED` | 是否自动发布到 kiro.rs，默认 `true` |
| `KIRO_RS_ADMIN_URL` | kiro.rs admin 后台地址，例如 `https://kiro.leftcode.xyz/admin` |
| `KIRO_RS_ADMIN_KEY` | kiro.rs admin API key；兼容 `KIRO_RS_SK`、`KIRO_RS_API_KEY`、`ADMIN_API_KEY` |
| `KIRO_AUTH_REGION` | AWS Builder ID 授权区域，默认 `us-east-1` |
| `KIRO_RS_PRIORITY` | 上传到 kiro.rs 的凭据优先级，默认 `0` |
| `KIRO_AUTO_PRO_TRIAL` | 是否注册成功后自动检测 Kiro PRO 试用资格，默认 `false` |
| `KIRO_PRO_TXT_DIR` | PRO 检测账号兜底目录；注册后检测会直接用刚注册的账号，资格检测不需要 `信用卡.txt` |
| `KIRO_PRO_PROFILE_DIR` | PRO 检测专用浏览器 profile |
| `KIRO_PRO_REUSE_PROFILE` | 是否复用 PRO 检测浏览器 profile，默认 `false` |
| `KIRO_PRO_RESULT_PATH` | PRO 检测结果 JSON 输出路径 |
| `KIRO_PRO_EVENTS_PATH` | PRO 检测事件日志输出路径 |
| `TEMP_MAIL_PROVIDER` | 临时邮箱渠道：`cloudflare-temp-email` 或 `gptmail`，默认 `cloudflare-temp-email` |
| `CLOUDFLARE_TEMP_EMAIL_BASE_URL` | Cloudflare Temp Email 服务地址 |
| `CLOUDFLARE_TEMP_EMAIL_ADMIN_AUTH` | Cloudflare Temp Email 管理密码，请求头 `x-admin-auth` |
| `CLOUDFLARE_TEMP_EMAIL_CUSTOM_AUTH` | 可选自定义密码，请求头 `x-custom-auth` |
| `CLOUDFLARE_TEMP_EMAIL_MODE` | 邮箱生成方式：`random` 随机生成，`pool` 从 txt 邮箱池取 |
| `CLOUDFLARE_TEMP_EMAIL_DOMAIN` | `random` 模式创建邮箱使用的域名 |
| `CLOUDFLARE_TEMP_EMAIL_USE_RANDOM_SUBDOMAIN` | `random` 模式是否启用随机子域名，默认 `false` |
| `CLOUDFLARE_TEMP_EMAIL_POOL_PATH` | `pool` 模式邮箱池 txt 路径，每行一个邮箱 |
| `CLOUDFLARE_TEMP_EMAIL_POOL_RECEIVER` | `pool` 模式固定查信邮箱，例如 `icloud@scveq.com` |
| `GPTMAIL_BASE_URL` | GPTMail 服务地址，默认 `https://mail.chatgpt.org.uk` |
| `GPTMAIL_API_KEY` | GPTMail API Key，请求头 `X-API-Key` |
| `GPTMAIL_DOMAIN` | 可选：GPTMail 生成邮箱时指定域名 |
| `GPTMAIL_PREFIX` | 可选：GPTMail 生成邮箱时指定邮箱前缀 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 可选代理，也可以用 `--proxy` 传入 |


临时邮箱渠道选择：

```env
# 默认自建 Cloudflare Temp Email
TEMP_MAIL_PROVIDER=cloudflare-temp-email

# 改用 GPTMail
# TEMP_MAIL_PROVIDER=gptmail
```

Cloudflare Temp Email 支持两种邮箱生成方式：

**1. 随机生成模式（默认）**

```env
CLOUDFLARE_TEMP_EMAIL_MODE=random
CLOUDFLARE_TEMP_EMAIL_DOMAIN=scveq.com
CLOUDFLARE_TEMP_EMAIL_USE_RANDOM_SUBDOMAIN=false
```

脚本会调用 `/admin/new_address` 创建新邮箱，并用这个邮箱查询验证码。

**2. 邮箱池模式**

```env
CLOUDFLARE_TEMP_EMAIL_MODE=pool
CLOUDFLARE_TEMP_EMAIL_POOL_PATH=txt/cloudflare-temp-email-pool.txt
CLOUDFLARE_TEMP_EMAIL_POOL_RECEIVER=icloud@scveq.com
```

邮箱池文件格式：

```txt
xxx@aaa.com
bbb@aaa.com
```

pool 模式下，注册页面填写的是邮箱池里选中的邮箱；查询 AWS 验证码时不会查该邮箱本身，而是用 Cloudflare Temp Email 的 admin key 查询 `CLOUDFLARE_TEMP_EMAIL_POOL_RECEIVER` 这个固定接收邮箱。

Cloudflare Temp Email 用法：

```bash
# .env
TEMP_MAIL_PROVIDER=cloudflare-temp-email
CLOUDFLARE_TEMP_EMAIL_BASE_URL=https://your-cloudflare-temp-email.example.com
CLOUDFLARE_TEMP_EMAIL_ADMIN_AUTH=你的管理密码
CLOUDFLARE_TEMP_EMAIL_DOMAIN=scveq.com

# 自测邮箱配置
npm run register -- --test-mail

# 正常注册会自动使用 Cloudflare Temp Email
npm run register -- --count 1
```

GPTMail 用法：

```bash
# .env
TEMP_MAIL_PROVIDER=gptmail
GPTMAIL_BASE_URL=https://mail.chatgpt.org.uk
GPTMAIL_API_KEY=你的_GPTMail_API_Key

# 可选：指定域名或前缀，不需要就留空
GPTMAIL_DOMAIN=
GPTMAIL_PREFIX=

# 自测 GPTMail 创建邮箱
npm run register -- --test-mail

# 正常注册会自动使用 GPTMail 查验证码
npm run register -- --count 1
```

GPTMail 接口对应关系：创建邮箱走 `POST/GET /api/generate-email`，查询邮件走 `GET /api/emails?email=<邮箱>`，鉴权使用请求头 `X-API-Key`。


Kiro PRO 试用资格检测：

```bash
# 命令行临时开启
npm run register -- --count 1 --auto-pro-trial

# 或在 .env 开启
KIRO_AUTO_PRO_TRIAL=true
KIRO_PRO_TXT_DIR=txt
KIRO_PRO_PROFILE_DIR=.browser-profile/kiro-pro-trial
KIRO_PRO_REUSE_PROFILE=false
```

检测链路：`AWS Builder ID 注册成功` -> `复用当前注册浏览器打开 Kiro` -> `生成 Kiro Pro Stripe Checkout` -> `读取 checkout total`。

当前只做资格判断：脚本会生成 Kiro Pro 的 Stripe Checkout，读取订单 total / 实付金额；如果 checkout 付款金额为 `0`，结果标记 `trial_eligible: true`，然后立即停止。这个阶段不读取 `txt/信用卡.txt`，不会提交付款、不会进入 3DS、不会真正开通 PRO，也不会发布到 kiro.rs。后续付款和发布 kiro.rs 链路待开发。结果写到 `KIRO_PRO_RESULT_PATH`，事件日志写到 `KIRO_PRO_EVENTS_PATH`。

kiro.rs 发布配置：

```env
KIRO_RS_UPLOAD_ENABLED=true
KIRO_RS_ADMIN_URL=https://kiro.leftcode.xyz/admin
KIRO_RS_ADMIN_KEY=你的_kiro_rs_admin_sk
KIRO_AUTH_REGION=us-east-1
KIRO_RS_PRIORITY=0
```

注册成功后的链路：

普通链路：`AWS Builder ID 注册完成` -> `轮询 device auth 拿 refreshToken/clientId/clientSecret` -> `POST /api/admin/credentials` 上传到 kiro.rs。

开启 PRO 检测时的临时链路：`AWS Builder ID 注册完成` -> `保留当前浏览器继续打开 Kiro` -> `检测 Kiro PRO 试用资格` -> `停止`。付款和发布 kiro.rs 等后续步骤待开发。

上传请求使用 `x-api-key: KIRO_RS_ADMIN_KEY`，payload 为 Builder ID 授权；脚本不会把 `refreshToken/clientSecret` 写入本地文件。

## 项目结构

```
kiro-auto/
├── lib/
│   ├── auth.ts              # AWS OIDC 认证
│   ├── kiro-rs-admin.ts     # kiro.rs admin 上传客户端
│   ├── kiro-client.ts       # Kiro Web/订阅链接客户端
│   ├── stripe-checkout.ts   # Stripe Checkout 金额检测
│   ├── pro-input.ts         # PRO 检测输入资料读取
│   ├── register.ts          # 注册核心逻辑
│   └── fingerprint/         # 浏览器指纹伪装
│       ├── generator.ts     # 指纹生成器
│       ├── injector.ts      # 指纹注入器
│       └── types.ts         # 类型定义
├── scripts/
│   ├── switch.ts            # 账号切换入口
│   └── register.ts          # 自动注册入口
├── show/                    # 本地结果目录（不写授权信息）
├── package.json
└── README.md
```

## 技术实现

### 注册流程
1. 向 AWS OIDC 申请设备码
2. 获取临时邮箱
3. 启动浏览器访问注册页面
4. 自动填写邮箱、姓名
5. 获取邮箱验证码并输入
6. 设置密码
7. 完成授权，获取 AWS Builder ID 授权
8. 普通模式：自动发布到 kiro.rs
9. 开启 PRO 试用检测时：复用当前注册浏览器打开 Kiro、生成 Pro checkout、读取订单/实付金额是否为 0 后停止，不付款、不发布

### 反检测机制
- 浏览器指纹伪装（Canvas、WebGL、Navigator 等）
- 页面预热行为模拟
- 输入延迟模拟
- 鼠标轨迹模拟

## 常见问题

**Q: 注册失败怎么办？**
- 检查网络是否能访问 AWS 服务
- 尝试增加任务间隔
- 使用代理

**Q: 机器码重置失败？**
- 需要以管理员身份运行终端

**Q: 找不到 Kiro 安装路径？**
- 默认路径：`C:\Users\<用户名>\AppData\Local\Programs\Kiro\Kiro.exe`

## 免责声明

1. 本工具仅供**学习研究**使用
2. 请勿将其用于任何商业或非法目的
3. 使用本工具产生的任何问题，由使用者自行承担
4. 请遵守 AWS 服务条款和相关法律法规

## 许可证

MIT License

---

如果这个项目对你有帮助，欢迎 Star！
