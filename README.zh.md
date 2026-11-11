# dsh-git-ship

[English](README.md) | 中文

DeepSeek Harness Web UI 插件：在对话输入框上方悬浮一个 Git 操作按钮。

- 插件包：仓库根（bundle 名 `dsh-git-ship`；本地开发时 link 到 `desktop` profile）
- 显示位置：`conversation.input.dock`，仅在有打开会话且会话空闲时渲染
- 宿主通道：`/api/git-ship`（`connection` 的 exact Fetch route，仅 owner Peer 可用）

## 行为

| 场景 | 表现 |
| --- | --- |
| 没有打开会话 | 不显示（该 slot 本身只在会话内渲染） |
| 会话正在输出 / 执行 | 不显示 |
| 会话空闲 | 显示；状态来自当前会话工作目录的 Git 仓库 |
| 执行 Git 操作中 | 主按钮禁用，左侧显示 spinner，文字改为「提交中 / 推送中 / 创建分支中 / 创建 PR 中」 |
| 工作区不是 Git 仓库 | 不显示 |

主按钮默认执行 `commit & push`；没有可提交更改但有待推送提交时退化为 `push`。
箭头展开当前状态下可用的操作：

- `commit`、`commit & push`、`commit & create PR`：有未提交更改时出现
- `push`：有未推送提交时出现
- `create PR`：分支已推送或可以推送时出现（没有可提交更改时仍可创建 PR）
- `create branch`：仓库内始终可用；选择后输入分支名
- `create branch, commit`、`create branch, commit & push`：有未提交更改时出现

操作完成后显示结果条（提交 hash、已推送、PR 链接等），20 秒后自动消失。

### 操作语义

- `commit` 优先只提交暂存区里的内容；暂存区为空时才执行 `git add -A` 再提交。提交说明取最近一条用户消息的首行（截断到 72 字符；没有用户消息时用 `chore: update files`）。自动暂存时未跟踪文件也会被提交，请配合 `.gitignore` 使用。
- `commit & create PR` / `create PR` 先推送（必要时 `--set-upstream`），再执行 `gh pr create --fill --head <branch>`。
- 找不到 `gh` 或创建失败时，会返回 GitHub compare 链接，结果条里可直接打开，不会丢失已经完成的提交和推送。
- 推送设置 `GIT_TERMINAL_PROMPT=0`，需要交互式凭据时会直接失败并显示 git 输出，不会挂起。

## 边界

- 浏览器只传 `sessionId` 和操作名；仓库路径由 Host 从 live Session 的 effective working directory 解析，不接受请求里的路径。
- Fetch route 走 `/api` 共享通道：connection 先做 cookie/Origin 校验，共享 handler 再要求 `peer.principal.kind === 'owner'`。
- 同一会话同一时间只允许一个 Git 操作。

## 从 GitHub 安装

在 DSH 中打开「插件」→「添加插件」→「安装第三方插件」，填入：

```text
https://github.com/chunyangqiao/dsh-git-ship
```

或 `github:chunyangqiao/dsh-git-ship`。

`lib/` 不在仓库里，从 Git 安装时由 `prepare` 现场构建。pnpm 11 默认禁止 Git 包执行构建脚本，第一次安装会报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`；在安装对话框选择**允许这些脚本并重试**即可，DSH 会把这次 commit 写进 profile 的 `allowBuilds`。更新到新 commit 后会再次要求批准。

构建过程还需要 `PATH` 中有 `npm`，并且 npm 源可达：pnpm 会先在 checkout 里执行 `npm install`，再运行 `prepare`。不要用 GitHub 的归档（`.tar.gz`）地址安装，tarball 不会执行 `prepare`，而 `lib/` 又不在仓库里。

安装完成后按 DSH 提示重启 Host；浏览器端刷新页面。同一 profile 如果已经装了本地 `link:` 版本，先卸载或更新。

## 开发与验证

```bash
npm test        # Git 核心流程与 /api/git-ship 路由
npm run build   # 生成 lib/index.js 和浏览器 client 包
```

安装与验证：

- profile 中 `dsh-git-ship` 已 link 到仓库根，`import('dsh-git-ship')` 可解析 `apply` / `inject`
- 17 个自动化测试通过（命令见上）

修改安装路径后，Host 需要重启 DSH 才会从新路径重新加载；重启后再确认 `application: applied` 和 Client slot。

未验证：浏览器中的实际渲染、菜单定位与主题明暗效果（当前会话没有浏览器控制能力）。
Client bundle 改动刷新页面后生效；Host 侧改动需要重启 DSH。

## 许可证

[MIT](LICENSE) © 2026 chunyangqiao
