# AWS Builder ID Account Tool

> AWS Builder ID 账号自动化管理工具，支持自动注册与账号切换

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)](https://www.typescriptlang.org/)

## 特性

### 自动注册
- Playwright 自动化浏览器注册
- Cloudflare Temp Email 自动获取验证码
- 注册成功后自动发布授权到 kiro.rs
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

# 启动自动注册（默认前台显示、并发 3、注册 3 个）
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

# 自测 Cloudflare Temp Email 配置
npm run register -- --test-mail

# 默认会发布到 kiro.rs；如需临时关闭
npm run register -- --count 1 --no-publish-kiro-rs
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
| `--concurrency` | `-c` | 3 | 并发注册数 |
| `--delayMs` / `--delay` | `-d` | 0 | 注册间隔（毫秒） |
| `--proxy` / `--proxyUrl` | - | 空 | 代理服务器地址 |
| `--non-interactive` | `-y` | 交互菜单 | 非交互运行 |
| `--show-browser` / `--headed` | - | 默认 | 前台显示浏览器 |
| `--headless` | - | 关闭 | 后台运行浏览器 |
| `--test-mail` | - | 关闭 | 只测试 Cloudflare Temp Email 创建邮箱 |
| `--no-publish-kiro-rs` | - | 自动发布 | 临时关闭 kiro.rs 自动发布 |
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
| `CLOUDFLARE_TEMP_EMAIL_BASE_URL` | Cloudflare Temp Email 服务地址 |
| `CLOUDFLARE_TEMP_EMAIL_ADMIN_AUTH` | Cloudflare Temp Email 管理密码，请求头 `x-admin-auth` |
| `CLOUDFLARE_TEMP_EMAIL_CUSTOM_AUTH` | 可选自定义密码，请求头 `x-custom-auth` |
| `CLOUDFLARE_TEMP_EMAIL_DOMAIN` | Cloudflare Temp Email 创建邮箱使用的域名 |
| `CLOUDFLARE_TEMP_EMAIL_USE_RANDOM_SUBDOMAIN` | 是否启用随机子域名，默认 `false` |
| `HTTP_PROXY` / `HTTPS_PROXY` | 可选代理，也可以用 `--proxy` 传入 |

Cloudflare Temp Email 用法：

```bash
# 自测邮箱配置
npm run register -- --test-mail

# 正常注册会自动使用 Cloudflare Temp Email
npm run register -- --count 1
```

kiro.rs 发布配置：

```env
KIRO_RS_UPLOAD_ENABLED=true
KIRO_RS_ADMIN_URL=https://kiro.leftcode.xyz/admin
KIRO_RS_ADMIN_KEY=你的_kiro_rs_admin_sk
KIRO_AUTH_REGION=us-east-1
KIRO_RS_PRIORITY=0
```

注册成功后的链路：

`AWS Builder ID 注册完成` -> `轮询 device auth 拿 refreshToken/clientId/clientSecret` -> `POST /api/admin/credentials` 上传到 kiro.rs。

上传请求使用 `x-api-key: KIRO_RS_ADMIN_KEY`，payload 为 Builder ID 授权；脚本不会把 `refreshToken/clientSecret` 写入本地文件。

## 项目结构

```
kiro-auto/
├── lib/
│   ├── auth.ts              # AWS OIDC 认证
│   ├── kiro-rs-admin.ts     # kiro.rs admin 上传客户端
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
8. 自动发布到 kiro.rs

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
