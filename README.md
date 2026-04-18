# 🚀 AWS Builder ID Account Tool

> 一个高效的 AWS Builder ID 账号管理工具，支持自动化注册与账号切换

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![npm Version](https://img.shields.io/badge/npm-9.x-red)](https://www.npmjs.com/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-blue)](https://www.typescriptlang.org/)

## 📋 目录

- [特性](#-特性)
- [快速开始](#-快速开始)
- [安装指南](#-安装指南)
- [使用方法](#-使用方法)
- [命令行参数](#-命令行参数)
- [项目结构](#-项目结构)
- [配置说明](#-配置说明)
- [贡献指南](#-贡献指南)
- [许可证](#-许可证)
- [免责声明](#-免责声明)

## ✨ 特性

### 🔄 账号切换
- 🎯 交互式菜单操作
- 🔀 快速切换账号
- 🔄 自动重启应用程序
- 🆔 机器码重置功能

### 🤖 自动注册
- ⚡ Playwright 自动化浏览器
- 📧 临时邮箱集成
- 📦 支持批量注册
- 🔒 浏览器指纹生成

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/AERT-7Y/kiro-auto.git
cd kiro-auto

# 安装依赖
npm install

# 安装浏览器
npm run install-browser

# 启动账号切换
npm run switch

# 或启动自动注册
npm run register -- --count 1
```

## 📥 安装指南

### 环境要求

| 要求 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18.0.0 | JavaScript 运行时 |
| npm | ≥ 9.x | 包管理器 |
| Git | 任意版本 | 代码版本控制 |

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/AERT-7Y/kiro-auto.git

# 2. 进入目录
cd kiro-auto

# 3. 安装依赖
npm install

# 4. 安装 Playwright 浏览器
npm run install-browser
```

## 📖 使用方法

### 账号切换

启动交互式账号切换菜单：

```bash
npm run switch
```

这将打开一个交互式界面，你可以：
- 查看当前账号列表
- 选择要切换的账号
- 重置机器码
- 添加新账号

### 自动注册

批量注册新的 Builder ID 账号：

```bash
# 注册单个账号
npm run register -- --count 1

# 注册多个账号（10个）
npm run register -- --count 10

# 指定并发数
npm run register -- --count 10 --concurrency 3

# 指定注册间隔
npm run register -- --count 5 --delayMs 5000

# 使用代理
npm run register -- --count 5 --proxyUrl "http://127.0.0.1:8080"
```

## ⚙️ 命令行参数

| 参数 | 简写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--count` | `-n` | number | 1 | 注册账号数量 |
| `--concurrency` | `-c` | number | 1 | 并发注册数 |
| `--delayMs` | `-d` | number | 0 | 注册间隔（毫秒） |
| `--proxyUrl` | - | string | - | 代理服务器地址 |

## 📁 项目结构

```
kiro-auto/
├── lib/
│   ├── auth.ts                 # 授权认证模块
│   ├── register.ts             # 注册逻辑
│   └── fingerprint/
│       ├── generator.ts        # 指纹生成器
│       ├── font-injector.ts    # 字体注入
│       ├── clientrects-injector.ts  # Canvas 指纹
│       ├── advanced-injector.ts     # 高级指纹混淆
│       ├── manager.ts         # 指纹管理器
│       ├── injector.ts         # 基础注入器
│       ├── types.ts            # 类型定义
│       └── validator.ts       # 指纹验证
├── scripts/
│   ├── switch.ts               # 账号切换入口
│   └── register.ts             # 自动注册入口
├── show/
│   └── .gitkeep                # 运行时数据目录
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
└── 教程.txt
```

## 🔧 配置说明

### 代理配置

支持 HTTP/HTTPS/SOCKS 代理：

```bash
npm run register -- --count 5 --proxyUrl "http://user:pass@127.0.0.1:8080"
```

### 指纹配置

浏览器指纹会在 `lib/fingerprint/` 目录下自动生成和管理。每次注册会使用不同的指纹组合，提高账号安全性。

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 开发环境

```bash
# 克隆你的 Fork
git clone https://github.com/你的用户名/kiro-auto.git
cd kiro-auto

# 添加上游仓库
git remote add upstream https://github.com/AERT-7Y/kiro-auto.git

# 创建开发分支
git checkout -b develop

# 安装依赖
npm install

# 运行开发版本
npm run switch
```

## 📄 许可证

本项目基于 MIT 许可证开源。详情请参阅 [LICENSE](LICENSE) 文件。

## ⚠️ 免责声明

1. 本工具仅供**学习研究**使用
2. 请勿将其用于任何商业或非法目的
3. 使用本工具产生的任何问题，由使用者自行承担
4. 请遵守 AWS 服务条款和相关法律法规

---

## 📞 联系方式

- GitHub Issues: https://github.com/AERT-7Y/kiro-auto/issues
- GitHub Repository: https://github.com/AERT-7Y/kiro-auto

---

⭐ 如果这个项目对你有帮助，欢迎 Star！
