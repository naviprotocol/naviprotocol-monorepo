# Sui SDK v2 transport 性能对比

> **Note (2026-07-16):** the benchmark tool `scripts/sdk-transport-benchmark.mjs`
> (`pnpm benchmark:sdk-transport`) is still maintained and can be re-run at any
> time. The result tables below are a historical snapshot from the v1→v2 upgrade
> acceptance (2026-06-22). Functional regression lives separately in
> [`test/regression/README.md`](../../test/regression/README.md).

## 结论

当前 GraphQL 使用边界是正确的，不需要调整：

- SDK release 主路径继续使用 gRPC/Core API 做 current-state read、simulate 和
  execute。
- GraphQL 只用于 Sui native history、filter、join、object history 等能力。
- NAVI/Open API service history 继续走 NAVI service endpoint；除非明确重做成
  Sui native history，否则不要为了 transport 纯度改成 GraphQL。

代码扫描确认：

- SDK runtime packages 没有把 GraphQL 用在普通 balance、coin、object、simulate
  主路径。
- `packages/lending/src/sui.ts` 只负责可选 `graphql` client 接入和
  `requireNaviGraphQLClient(...)` guard。
- 直接 GraphQL 调用只出现在 smoke / benchmark 脚本和测试中，不是业务主路径。

## 运行方式

使用已提交脚本：

```bash
SUI_GRPC_ENDPOINT=fullnode.mainnet.sui.io:443 \
SUI_JSON_RPC_URL=https://fullnode.mainnet.sui.io:443 \
SUI_GRAPHQL_URL=https://graphql.mainnet.sui.io/graphql \
SUI_SMOKE_ADDRESS=0x439f285f559997df4b4ad42c282581b1ca991631ab020a29c8031a0849b7e30f \
SUI_SMOKE_TRANSACTION_DIGEST=GrxevBPJrUaMfdosa7K1KtM8HfhRLpiPwdmVc38RxjL6 \
NAVI_BENCH_ITERATIONS=8 \
NAVI_BENCH_CONCURRENT_ITERATIONS=15 \
NAVI_BENCH_CONCURRENCY=5 \
NAVI_BENCH_WARMUP=2 \
pnpm benchmark:sdk-transport
```

脚本不读取私钥，不执行真实交易。它统计顺序请求和并发 5 请求下的 p50 / p95
latency。

## 2026-06-22 结果

环境：

- Network：mainnet。
- gRPC：`fullnode.mainnet.sui.io:443`。
- JSON-RPC：`https://fullnode.mainnet.sui.io:443`。
- GraphQL：`https://graphql.mainnet.sui.io/graphql`。
- 完整日志：`/tmp/navi-sdk-transport-benchmark-20260622.log`。

关键 p50 结果：

| Case | JSON-RPC seq | gRPC seq | gRPC / JSON seq | JSON-RPC c5 | gRPC c5 | gRPC / JSON c5 | 结论 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `balance.sui` | 189.4ms | 190.8ms | 1.01x | 190.6ms | 200.2ms | 1.05x | 基本持平。 |
| `balances.list` | 388.8ms | 194.6ms | 0.50x | 459.0ms | 221.0ms | 0.48x | gRPC 更快。 |
| `coins.sui.limit5` | 188.7ms | 201.4ms | 1.07x | 192.0ms | 261.4ms | 1.36x | 并发 coin read 需要观察。 |
| `ownedObjects.limit10` | 915.8ms | 572.2ms | 0.62x | 990.9ms | 1185.5ms | 1.20x | 有波动，非阻塞。 |
| `object.single` | 108.3ms | 108.5ms | 1.00x | 116.1ms | 116.4ms | 1.00x | 持平。 |
| `objects.multi` | 192.3ms | 195.9ms | 1.02x | 185.9ms | 187.1ms | 1.01x | 持平。 |
| `simulate.selfTransfer` | 193.4ms | 203.8ms | 1.05x | 213.3ms | 196.1ms | 0.92x | 持平；并发下 gRPC 略快。 |
| `transaction.effects` | 108.7ms | 113.7ms | 1.05x | 186.1ms | 188.8ms | 1.01x | 持平。 |

GraphQL 观察：

| Case | GraphQL seq p50 | GraphQL c5 p50 | 结论 |
| --- | ---: | ---: | --- |
| `graphql.history` | 344.3ms | 356.0ms | 适合作为 history/filter 能力。 |
| current-state balance / coin / object read | 348.6ms 到 2373.0ms | 通常比 gRPC / JSON-RPC 慢 2x-12x | 不应用在 SDK 主 read 路径。 |

## 风险和处理

- 没发现 gRPC 对 SDK 主路径有系统性性能回退。
- 唯一需要观察的是并发 `listCoins`。如果 open-api 或 Copilot 对同一
  owner / coin type 并发请求多个协议，应在一次 request 内共享或缓存 coin read，
  避免重复并发打节点。
- 大版本发布前应使用生产私有 gRPC provider 再跑同一脚本。public endpoint 的数据
  能看 regression shape，但 provider p95 可能不同。

## 发布 gate

未来 benchmark 出现以下情况应先排查：

- 多个 current-state 主路径 case 中，gRPC p50 超过 JSON-RPC 的 1.3x。
- balance、coin、object、simulate 路径中，gRPC p95 超过 JSON-RPC 的 2x。
- 任意 benchmark row 出现失败。

GraphQL 不应按普通 current-state path 和 JSON-RPC 做发布 gate 对比，因为生产 SDK
不应该在这些路径使用 GraphQL。
