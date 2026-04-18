# AWS Builder ID Account Tool

> AWS Builder ID 账号自动化管理工具，支持自动注册与账号切换

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)](https://www.typescriptlang.org/)

## 特性

### 自动注册
- Playwright 自动化浏览器注册
- 临时邮箱自动获取验证码
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

# 启动自动注册
npm run register -- --count 1

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

# 注册多个账号
npm run register -- --count 10

# 指定并发数
npm run register -- --count 10 --concurrency 3

# 指定注册间隔
npm run register -- --count 5 --delayMs 5000

# 使用代理
npm run register -- --count 5 --proxyUrl "http://127.0.0.1:7890"
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
| `--count` | `-n` | 1 | 注册账号数量 |
| `--concurrency` | `-c` | 1 | 并发注册数 |
| `--delayMs` | `-d` | 0 | 注册间隔（毫秒） |
| `--proxyUrl` | `--proxy` | - | 代理服务器地址 |
| `--non-interactive` | - | - | 非交互模式 |
| `--no-fingerprint` | - | - | 禁用指纹伪装 |
| `--no-incognito` | - | - | 禁用无痕模式 |

## 项目结构

```
kiro-auto/
├── lib/
│   ├── auth.ts              # AWS OIDC 认证
│   ├── register.ts          # 注册核心逻辑
│   └── fingerprint/         # 浏览器指纹伪装
│       ├── generator.ts     # 指纹生成器
│       ├── injector.ts      # 指纹注入器
│       └── types.ts         # 类型定义
├── scripts/
│   ├── switch.ts            # 账号切换入口
│   └── register.ts          # 自动注册入口
├── show/
│   ├── builderid-template.json  # 账号模板
│   └── results.json         # 注册结果
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
7. 完成授权，获取 SSO Token

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
