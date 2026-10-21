# 作者布局算法追踪与本地复现

## 结论

2026-10-12 的进一步追查、纯 C++ 历史公式和实测参数对照见 [原始参数追查](parameter-recovery.md)。本文以下力学公式和视频过程均指 2025 年视频发布版本，不能直接当成旧网页数据的生成配置。

作者使用的是**自定义力导向图布局**，主要由全局排斥、非线性边力、速度阻尼、镜像约束和四维坐标松弛组成。较大的图通过 CUDA 和均匀空间分桶加速。这里的源码不是标准 Fruchterman–Reingold、ForceAtlas2、t-SNE 或 UMAP 的直接调用，也不是 Barnes–Hut 八叉树。

本项目已经从原始拓扑重新生成 25,955 个节点的坐标，并可在页面「布局对照」中切换。复现的是历史源码中的力学模型及主要设计，**不是作者坐标的逐点或逐位还原**。

## 确认来源

作者网页仓库 [Klotski-Webpage](https://github.com/2swap/Klotski-Webpage) 的 README 说，公开坐标来自旧 `Old-Graph-Spreader`，功能后来大量迁入 SwapTube。旧仓库的原地址目前返回 404。

继续查阅 SwapTube 的完整 Git 历史，找到了提交：

- SHA：`2c7d90dda292ea12245ed90115eb20002fbc3c26`
- 提交日期：2025-08-22
- 提交说明：`Klotski release rendered on this commit`
- [提交链接](https://github.com/2swap/swaptube/commit/2c7d90dda292ea12245ed90115eb20002fbc3c26)

因此可以直接查到正式视频的脚本，而不必只根据目前主分支或视频外观猜测。但不能据此断言网页里更早发布的坐标与视频坐标由完全相同的代码及参数产生。

关键源码均固定到该提交：

| 文件 | 证据位置 | 内容 |
|---|---|---|
| [GraphSpread.cu](https://github.com/2swap/swaptube/blob/2c7d90dda292ea12245ed90115eb20002fbc3c26/src/CUDA/GraphSpread.cu) | 16–23、229–300、334–435 行 | 力学公式、镜像、限速、分桶 |
| [Graph.cpp](https://github.com/2swap/swaptube/blob/2c7d90dda292ea12245ed90115eb20002fbc3c26/src/DataObjects/Graph.cpp) | 24–31、250–263、442–490 行 | 随机初值、在父节点附近添加节点、镜像索引 |
| [Klotski.cpp](https://github.com/2swap/swaptube/blob/2c7d90dda292ea12245ed90115eb20002fbc3c26/src/Projects/Klotski.cpp) | 1306–1350 行 | 大图增长和参数变化脚本 |
| [GraphScene.cpp](https://github.com/2swap/swaptube/blob/2c7d90dda292ea12245ed90115eb20002fbc3c26/src/Scenes/Math/GraphScene.cpp) | 34–42 行 | 默认吸引、排斥、阻尼等参数 |
| [KlotskiBoard.cpp](https://github.com/2swap/swaptube/blob/2c7d90dda292ea12245ed90115eb20002fbc3c26/src/DataObjects/KlotskiBoard.cpp) | 59–103 行 | 上下、左右翻转对应的棋盘哈希 |

`research/upstream/` 保存了本机研究时的上游克隆与历史源码摘取，已从本仓库 Git 排除；以上固定 SHA 链接是可重取的依据。

## 实际力学模型

令节点位置为四维向量 `p_i=(x,y,z,w)`，速度为 `v_i`。记 `Δ=p_i-p_j`，`r=||Δ||`。

### 全局排斥

每对节点的排斥贡献为：

```text
F_rep(i,j) = normalize(Δ) / [10 × (r² + 1) + 2]
v_i += repel × Σ F_rep(i,j)
```

远处的量级接近平方反比；分母的常量缓和近距离作用。我们的版本对重合节点显式返回零，避免 `normalize(0)`。

### 沿边的非线性作用

对每条连接 i、j 的边：

```text
t = 0.05 × (r² + 1)³
g = 0.2 × (t - 1)/(t + 1) - 0.1
v_i -= attract × Δ × g
```

短距离时 `g` 为负，这一项把节点推开；距离大时 `g` 趋于 0.1，将节点拉近。所以“连线就是普通弹簧”只是粗略比喻。这也与当前主分支使用单位方向向量的版本不同，不能混用两套公式。

### 镜像约束

程序找到当前棋盘左右翻转后的对应节点 `m(i)`，把它的 x 坐标取反，作为目标：

```text
H(x,y,z,w) = (-x,y,z,w)
p_i.xyz += mirror_force × [H(p_m(i)).xyz - p_i.xyz]
```

这属于人为加入的布局约束。棋盘的对称关系来自规则，但图形沿固定平面对称，不是完全依靠普通力导向自行形成。

历史源码还支持棋盘上下翻转节点的约束。当前这 25,955 个节点所在的连通分量没有上下翻转后的另一整片分量，因此本次只实现适用的左右镜像约束；没有把不可达局面混入当前图。

### 速度和维数

```text
将速度长度限制到 20
v_i *= decay
p_i += v_i
p_i.z *= clamp(dimensions - 2, 0, 1)
p_i.w *= clamp(dimensions - 3, 0, 1)
```

`dimensions=3.98` 的字面含义是第四维每步乘 0.98，不是图具有分形维数 3.98。第四维仍参与距离和受力计算，只是持续被压缩；设为 3 后，第四维归零。可以把这种设计理解为给布局额外的伸展空间再压回三维，这一动机解释是根据算法行为作出的推断。

## 正式视频的生成过程

1. 从棋盘开始逐渐扩展图；新节点在已存在的父节点附近初始化，继承父节点速度并叠加位置扰动。
2. 前期使用 `decay=.92`、`dimensions=2.98` 等默认场景设置。
3. 大图展开时将 `mirror_force` 转向 `.003`、`decay` 转向 `.65`，`dimensions` 转向 `3.98`；`physics_multiplier` 为每帧内的物理迭代数，转向 800。
4. 节点全部加入后继续播放 15 秒，期间将迭代数转向 400、维数转向 `3.95`。
5. 最后将迭代数转向 0、维数转向 3，冻结布局，开始解集及路径讲解。

这些参数是随场景时间过渡的，并非从头到尾固定。镜头旋转、缩放另有四元数和场景参数，不能当作节点布局本身。

## 如何加速

- 节点数小于 5,000 时，全对全计算排斥，复杂度 O(N²)。
- 大图划分为 `10 × 10 × 10` 个三维空间桶。
- 当前节点周围 `3 × 3 × 3` 桶中的节点逐个计算。
- 远桶用“节点数 × 桶质心的作用力”近似。
- 桶按 xyz 分组，但受力距离与质心仍含 w。
- 边力直接访问邻接表，复杂度 O(E)。

这是固定均匀网格的近远场近似，不是自适应的 Barnes–Hut 树。若节点集中在少数桶内，它仍可能接近二次复杂度。

## 本次实现与作者的差别

`scripts/generate_layout.py` 只读取棋盘字符串、邻接表、初始棋盘。原坐标不参与初始化或优化。它按 BFS 顺序增长，使用 NumPy 种子 7 的随机扰动，调用 `scripts/layout_kernel.cu` 的 CUDA 计算，然后居中缩放导出 xyz。

采用参数：`repel=1`、`attract=1`、`decay=.65`、`mirror_force=.003`；增长阶段维数 3.98，松弛阶段 3.95，最后 3。每个增长批次 80 次迭代，完整图松弛 12,000 次，压到三维后 1,000 次。

明确的差别：

- 没有逐帧重播视频中的音频时长、插值曲线和节点增长调度。
- 使用固定 BFS 顺序和 NumPy 随机数，未复用 C++ `rand()` 与哈希表遍历顺序。
- 每一步重新构建空间桶和质心。历史实现每次批量调用只构建一次桶，内部多次迭代复用旧的排序坐标，因此其排斥场在一批迭代中滞后。
- 用双缓冲同步更新坐标，避免历史 `mirror_kernel` 原地读写邻居坐标时的线程时序依赖。
- 仅实现当前连通分量需要的左右镜像约束。
- 最终额外做三维松弛；视频则随场景过渡逐渐冻结。

因此生成结果呈现相同的节点与连接，以及局部网格、团簇和通道，但全局外观不能保证与视频或网页一致。迭代次数增加也不等于数学上证明收敛。GPU 原子求和的顺序还可能带来小的浮点差异，固定种子不承诺跨显卡逐位一致。

## 运行与对照

生成器依赖 NumPy、NVIDIA GPU 和 CUDA Toolkit 的 `nvcc`；网页显示仍只需要 WebGL，不需要 CUDA。

```sh
python3 scripts/generate_layout.py
python3 tests/test_topology.py
python3 tests/test_layout.py
npm test

# 同样的参数、随机种子，取消镜像约束做消融对照
python3 scripts/generate_layout.py --mirror-force 0 --output research/runs/layout-no-mirror.json

# 绘图额外需要 matplotlib
python3 scripts/compare_layouts.py
```

结果位置：

- `public/layout-rebuilt.json`：最终坐标、参数、来源图的 SHA-256、测量时间。
- `research/layout-comparison.png`：作者坐标、本地坐标以及无镜像约束对照的正面、侧面图。
- `research/layout-metrics.json`：归一化后的边长分位数与左右镜像残差，不能当作整体布局优劣评分。
- `research/runs/`：动态库、阶段检查点、消融坐标，属于可再生成的研究中间产物。

本次有镜像约束的完整生成在 RTX 3090 上耗时约 49.5 秒（不含首次编译）。这只是本机本次运行结果。

同种子、相同迭代安排的对照中，归一化坐标相对于固定 `x=0` 镜像平面的 RMS 残差如下：

| 坐标来源 | 镜像 RMS 残差 |
|---|---:|
| 作者网页数据 | 0.0000427 |
| 本地重算，镜像系数 0.003 | 0.0006583 |
| 本地重算，镜像系数 0 | 0.6611845 |

这个实验说明本次重算中的镜像约束有效地对齐了左右对应局面。该指标没有搜索任意旋转后的最佳镜像平面，不能据此断言无约束结果不存在其他方向的近似对称性，也不能用它证明与作者坐标一致。

## 验证范围

CPU 独立参考实现验证了 CUDA 的精确排斥、分桶排斥、非线性边力、镜像和速度更新；测试还验证：将输入 xyz 全部改为空值仍可生成同一拓扑、所有左右镜像索引互为映射、重合点不会产生非有限值。

棋盘测试遍历全部节点，确认每一条邻边与合法移动规则一致。页面布局切换只改变 xyz，棋盘状态、邻接关系和最短距离保持不变。
