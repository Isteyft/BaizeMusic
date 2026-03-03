# Baize

## 项目简介

Baize是一个使用monorepo结构构建的基础项目，采用pnpm workspace管理多个子项目和共享包。

## 目录结构

```
baize/
├── apps/                    # 应用目录
│   ├── backend/             # 后端应用
│   │   └── server/          # 服务器端代码
│   └── frontend/            # 前端应用
│       ├── desktop/         # 桌面端应用
│       ├── mobile/          # 移动端应用
│       └── website/             # Web端应用
├── packages/                # 共享包目录
│   ├── config/              # 配置共享包
│   ├── core/                # 核心功能共享包
│   ├── types/               # TypeScript类型定义共享包
│   ├── ui/                  # UI组件共享包
│   └── utils/               # 工具函数共享包
├── .cspell/                 # CSpell拼写检查配置
├── .editorconfig            # 编辑器配置
├── .gitignore               # Git忽略文件配置
├── .prettierignore          # Prettier忽略文件配置
├── .prettierrc              # Prettier配置
├── cspell.json              # CSpell配置
├── package.json             # 根项目配置
├── pnpm-lock.yaml           # pnpm依赖锁定文件
├── pnpm-workspace.yaml      # pnpm工作区配置
├── postcss.config.js        # PostCSS配置
├── tailwind.config.js       # Tailwind CSS配置
├── tsconfig.client.json     # TypeScript客户端配置
├── tsconfig.json            # TypeScript主配置
└── tsconfig.server.json     # TypeScript服务器端配置
```
