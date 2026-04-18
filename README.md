# AWS Account Tool

AWS Builder ID 账号管理工具。

## 功能

### 账号切换
- 交互式菜单
- 切换账号
- 自动重启应用
- 重置机器码

### 自动注册
- Playwright 自动化
- 临时邮箱集成
- 批量注册
- 浏览器指纹

## 安装

```bash
npm install
npm run install-browser
```

## 使用

```bash
# 账号切换
npm run switch

# 自动注册
npm run register -- --count 1
```

## 参数

- `--count/-n`: 注册数量
- `--concurrency/-c`: 并发数
- `--delayMs/-d`: 间隔毫秒
- `--proxyUrl`: 代理地址

## 结构

```
scripts/
  switch.ts    # 账号切换
  register.ts  # 自动注册
lib/
  register.ts  # 注册逻辑
  auth.ts      # 授权模块
  fingerprint/ # 指纹模块
```

## 免责声明

仅供学习研究使用。
