# 来源、数据版本与复现边界

## 原始材料

- 视频：2swap，[I Solved Klotski](https://www.youtube.com/watch?v=YGLNyHd2w10)。
- 网页与数据：[2swap/Klotski-Webpage](https://github.com/2swap/Klotski-Webpage)。
- 随附图数据可由固定提交 [`069d99b393eb06c37402598393806d84a41813ae`](https://github.com/2swap/Klotski-Webpage/blob/069d99b393eb06c37402598393806d84a41813ae/data.json) 的 `data.json` 重新转换得到；本次已验证转换输出与 `public/graph.json` 字节一致。
- 视频版力学模型参考 SwapTube 提交 [`2c7d90dda292ea12245ed90115eb20002fbc3c26`](https://github.com/2swap/swaptube/commit/2c7d90dda292ea12245ed90115eb20002fbc3c26)。
- 早期纯 C++ 公式参考提交 [`13842105e1c2a97b0e168d55601e4f5807cde0e2`](https://github.com/2swap/swaptube/blob/13842105e1c2a97b0e168d55601e4f5807cde0e2/src/scenes/Graph.cpp)。

仓库中的 GPL-3.0 许可继续保留，见根目录 `LICENSE`。这些链接是研究和实现来源，不代表原作者参与或认可本项目。

## 转换了什么

`prepare-data.mjs` 读取上游文件中的 JSON 对象和初始棋盘字符串，不执行其中的 JavaScript。转换保留节点顺序及棋盘编码，将邻接键转换为索引并去重，对 xyz 做包围盒居中和统一缩放，保留上游附带的距离字段。

网页在运行时使用本项目的规则重算最近解距离，并不直接信任附带距离字段。测试遍历全部局面，把每条邻边与独立实现的合法单格移动逐一比较。

转换与比对示例（先把固定版本数据下载到自行指定的临时路径）：

```sh
node scripts/prepare-data.mjs /path/to/data.json /tmp/graph-rebuilt.json
cmp public/graph.json /tmp/graph-rebuilt.json
```

不传第二个路径参数会覆盖 `public/graph.json`。更新数据版本后，应重新生成所有匹配布局、更新 `docs/data-manifest.json`，并运行完整规则与数据测试。不得只修改校验值来绕过来源不匹配。

[数据清单](data-manifest.json) 记录原始文件 SHA-256、转换后图和两套重算布局的校验值、文件大小与图统计。

## 本项目实现的边界

本项目实现了前端交互、规则、求解、可视化和离线重算程序。初始拓扑来自上游，独立验证不等于独立生成。重算程序从棋盘和邻接表初始化，原始 xyz 不参与初始化或优化。

相对于参考历史源码，本项目每步刷新空间桶，采用双缓冲同步更新，并使用不同的随机数、增长调度和最终松弛过程。源码版本与力公式也有明确区分，不能把多套历史实现混称为同一次重播。

旧网页数据和正式视频来自不同时间；视频版参数不自动等于旧网页坐标的生成配置。找不到旧配置、不支持静态反推、布局相似度不足等研究结果也属于需要保留的记录。详细证据及限定见：

- [布局公式、加速与实现差异](../research/layout.md)
- [参数追查、反推假设与候选实验](../research/parameter-recovery.md)

## 哪些内容不随应用发布

`downloads/` 的视频、字幕，`research/upstream/` 的上游源码副本，以及 `research/runs/` 的动态库、日志和检查点均由 Git 忽略。网页只加载 `public/` 中的本地资产。README 中的运行图是本项目界面截图；研究对照图由仓库脚本生成。
