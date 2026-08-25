import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type VaultTestReportStatus = 'passed' | 'skipped' | 'failed'

export type VaultTestReportEntry = {
  api: string
  title: string
  status: VaultTestReportStatus
  purpose: string
  data?: unknown
  validations?: string[]
  events?: unknown
  balanceChanges?: unknown
  reason?: string
}

type VaultTestReportOptions = {
  enabledBy: string | undefined
  network: string
  graphqlUrl: string
  grpcUrl: string
}

const DEFAULT_REPORT_PATH = fileURLToPath(
  new URL('../test-reports/vault-mainnet-report.html', import.meta.url)
)

function json(value: unknown) {
  return (
    JSON.stringify(
      value,
      (_key, current: unknown) => (typeof current === 'bigint' ? current.toString() : current),
      2
    ) ?? 'null'
  )
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusLabel(status: VaultTestReportStatus) {
  if (status === 'passed') return '通过'
  if (status === 'skipped') return '跳过'
  return '失败'
}

function renderJson(value: unknown) {
  return `<pre><code>${escapeHtml(json(value))}</code></pre>`
}

function renderJsonDetails(title: string, value: unknown, open = false) {
  return `<details class="data-panel"${open ? ' open' : ''}>
    <summary>${escapeHtml(title)}</summary>
    ${renderJson(value)}
  </details>`
}

function renderEvents(value: unknown) {
  if (!Array.isArray(value)) return renderJsonDetails('Dry-run 事件', value)
  if (value.length === 0) {
    return '<section class="evidence"><h4>Dry-run 事件 <span class="count">0</span></h4><p class="empty">没有返回事件</p></section>'
  }

  const events = value
    .map((event, index) => {
      if (!isRecord(event)) return `<li>${renderJson(event)}</li>`
      const eventType = event.eventType ?? 'Unknown event'
      const metadata = [event.module, event.sender]
        .filter((item) => item !== undefined)
        .map((item) => `<span class="meta-chip mono">${escapeHtml(item)}</span>`)
        .join('')
      return `<li class="event-item">
        <div class="event-heading">
          <span class="event-number">${index + 1}</span>
          <div><strong class="mono break">${escapeHtml(eventType)}</strong><div class="event-meta">${metadata}</div></div>
        </div>
        ${renderJsonDetails('解码后的事件数据', event.json, true)}
        ${renderJsonDetails('原始 BCS（Base64）', event.bcsBase64)}
      </li>`
    })
    .join('')

  return `<section class="evidence">
    <h4>Dry-run 事件 <span class="count">${value.length}</span></h4>
    <ol class="event-list">${events}</ol>
  </section>`
}

function amountClass(value: unknown) {
  try {
    const amount = BigInt(String(value))
    if (amount > 0n) return 'positive'
    if (amount < 0n) return 'negative'
  } catch {
    // Non-integer values remain neutral.
  }
  return 'neutral'
}

function renderBalanceChanges(value: unknown) {
  if (!Array.isArray(value)) return renderJsonDetails('Dry-run 余额变化', value)
  if (value.length === 0) {
    return '<section class="evidence"><h4>Dry-run 余额变化 <span class="count">0</span></h4><p class="empty">没有返回余额变化</p></section>'
  }

  const rows = value
    .map((change) => {
      if (!isRecord(change)) {
        return `<tr><td colspan="3">${renderJson(change)}</td></tr>`
      }
      return `<tr>
        <td class="mono break">${escapeHtml(change.coinType ?? '')}</td>
        <td class="mono break">${escapeHtml(change.address ?? '')}</td>
        <td class="amount ${amountClass(change.amount)}">${escapeHtml(change.amount ?? '')}</td>
      </tr>`
    })
    .join('')

  return `<section class="evidence">
    <h4>Dry-run 余额变化 <span class="count">${value.length}</span></h4>
    <div class="table-wrap"><table>
      <thead><tr><th>Coin type</th><th>Address</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`
}

function renderEntry(entry: VaultTestReportEntry, index: number) {
  const validations = entry.validations?.length
    ? `<section class="validation"><h4>验证规则</h4><ol>${entry.validations
        .map((validation) => `<li>${escapeHtml(validation)}</li>`)
        .join('')}</ol></section>`
    : ''
  const reason = entry.reason
    ? `<div class="reason"><strong>原因</strong><span>${escapeHtml(entry.reason)}</span></div>`
    : ''
  const search = `${entry.api} ${entry.title} ${entry.purpose}`.toLowerCase()

  return `<article class="test-card" data-status="${entry.status}" data-api="${escapeHtml(entry.api)}" data-search="${escapeHtml(search)}">
    <header class="test-header">
      <div class="test-index">${index + 1}</div>
      <div class="test-title">
        <div class="eyebrow"><span class="api">${escapeHtml(entry.api)}</span><span class="status ${entry.status}">${statusLabel(entry.status)}</span></div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.purpose)}</p>
      </div>
    </header>
    ${reason}
    ${validations}
    ${entry.data === undefined ? '' : renderJsonDetails('真实测试数据', entry.data)}
    ${entry.events === undefined ? '' : renderEvents(entry.events)}
    ${entry.balanceChanges === undefined ? '' : renderBalanceChanges(entry.balanceChanges)}
  </article>`
}

export class VaultTestReport {
  readonly enabled: boolean
  private readonly output: 'stdout' | string
  private readonly options: VaultTestReportOptions
  private readonly contexts: Array<{ title: string; data: unknown }> = []
  private readonly entries: VaultTestReportEntry[] = []

  constructor(options: VaultTestReportOptions) {
    this.options = options
    const requestedOutput = options.enabledBy?.trim()
    this.enabled = Boolean(requestedOutput)

    if (requestedOutput === 'stdout') {
      this.output = 'stdout'
    } else if (!requestedOutput || requestedOutput === '1' || requestedOutput === 'true') {
      this.output = DEFAULT_REPORT_PATH
    } else {
      this.output = isAbsolute(requestedOutput)
        ? requestedOutput
        : resolve(process.cwd(), requestedOutput)
    }
  }

  addContext(title: string, data: unknown) {
    if (this.enabled) this.contexts.push({ title, data })
  }

  add(entry: VaultTestReportEntry) {
    if (this.enabled) this.entries.push(entry)
  }

  hasFailures() {
    return this.entries.some((entry) => entry.status === 'failed')
  }

  private html() {
    const generatedAt = new Date().toISOString()
    const passed = this.entries.filter((entry) => entry.status === 'passed').length
    const skipped = this.entries.filter((entry) => entry.status === 'skipped').length
    const failed = this.entries.filter((entry) => entry.status === 'failed').length
    const apis = [...new Set(this.entries.map((entry) => entry.api))].sort()
    const apiOptions = apis
      .map((api) => `<option value="${escapeHtml(api)}">${escapeHtml(api)}</option>`)
      .join('')
    const contexts = this.contexts
      .map(
        (context) => `<article class="context-card">
          <h3>${escapeHtml(context.title)}</h3>
          ${renderJsonDetails('查看链上上下文', context.data)}
        </article>`
      )
      .join('')
    const entries = this.entries.map(renderEntry).join('')

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vault SDK 主网测试报告</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#647089; --line:#dce2ec; --paper:#fff; --bg:#f3f6fa; --navy:#13213a; --blue:#2563eb; --green:#16845b; --amber:#b36b00; --red:#c83e4d; --code:#101827; }
    * { box-sizing: border-box; }
    body { overflow-x:hidden; margin:0; color:var(--ink); background:var(--bg); font:14px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .hero { color:#fff; background:radial-gradient(circle at 78% 18%, #315b9d 0, transparent 30%), linear-gradient(135deg, #101a2d, #1a3154); padding:52px 24px 76px; }
    .hero-inner, main { width:min(1180px, 100%); margin:auto; }
    .kicker { color:#9fc0ff; font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:8px 0 10px; font-size:clamp(30px, 5vw, 52px); line-height:1.12; letter-spacing:-.035em; }
    .subtitle { max-width:760px; color:#cfdaeb; font-size:16px; }
    .summary { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px; margin-top:32px; }
    .metric { border:1px solid rgba(255,255,255,.14); border-radius:14px; background:rgba(255,255,255,.08); padding:16px 18px; backdrop-filter:blur(8px); }
    .metric span { display:block; color:#b9c7dc; font-size:12px; }
    .metric strong { display:block; margin-top:2px; font-size:28px; line-height:1.2; }
    main { margin-top:-42px; padding:0 24px 64px; }
    .panel, .test-card, .context-card { border:1px solid var(--line); border-radius:16px; background:var(--paper); box-shadow:0 8px 30px rgba(18,31,53,.06); }
    .metadata { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:1px; overflow:hidden; margin-bottom:22px; }
    .metadata div { min-width:0; padding:16px 18px; background:#fff; }
    .metadata span { display:block; color:var(--muted); font-size:11px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; }
    .metadata code { display:block; max-width:100%; overflow:hidden; margin-top:3px; text-overflow:ellipsis; white-space:nowrap; }
    .policy { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:0 0 30px; }
    .policy div { min-width:0; overflow-wrap:anywhere; border-left:4px solid var(--blue); border-radius:8px; background:#eaf1ff; padding:13px 16px; }
    .section-heading { display:flex; align-items:end; justify-content:space-between; gap:20px; margin:34px 0 14px; }
    .section-heading h2 { margin:0; font-size:22px; letter-spacing:-.02em; }
    .section-heading p { margin:0; color:var(--muted); }
    .context-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px,1fr)); gap:14px; }
    .context-card { padding:18px; }
    .context-card h3 { margin:0 0 10px; }
    .toolbar { position:sticky; top:0; z-index:5; display:grid; grid-template-columns:1fr auto auto; gap:12px; padding:14px; margin-bottom:16px; }
    input, select, button { min-height:40px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); font:inherit; }
    input, select { min-width:0; width:100%; padding:8px 11px; }
    .status-filters { display:flex; gap:6px; }
    button { cursor:pointer; padding:7px 12px; font-weight:700; }
    button.active { border-color:var(--navy); color:#fff; background:var(--navy); }
    .test-list { display:grid; min-width:0; gap:16px; }
    .test-card { min-width:0; max-width:100%; overflow:hidden; padding:22px; border-left:5px solid var(--line); }
    .test-card[data-status="passed"] { border-left-color:var(--green); }
    .test-card[data-status="skipped"] { border-left-color:var(--amber); }
    .test-card[data-status="failed"] { border-left-color:var(--red); }
    .test-card.hidden { display:none; }
    .test-header { display:grid; grid-template-columns:38px 1fr; gap:14px; }
    .test-index { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; color:#fff; background:var(--navy); font-weight:800; }
    .eyebrow { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:5px; }
    .api, .status, .meta-chip, .count { display:inline-flex; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:800; }
    .api { display:inline-block; max-width:100%; overflow-wrap:anywhere; word-break:break-all; white-space:normal; color:#244b8d; background:#e8f0ff; }
    .status.passed { color:#086242; background:#dcf7eb; }
    .status.skipped { color:#8c5300; background:#fff0d4; }
    .status.failed { color:#9e2330; background:#ffe4e7; }
    .test-title { min-width:0; }
    .test-title h3 { overflow-wrap:anywhere; margin:0; font-size:19px; letter-spacing:-.015em; }
    .test-title p { margin:4px 0 0; color:var(--muted); }
    .reason { display:flex; gap:10px; overflow-wrap:anywhere; margin:16px 0 0 52px; border-radius:9px; color:#7b4900; background:#fff4de; padding:10px 12px; }
    .reason span { min-width:0; overflow-wrap:anywhere; }
    .validation, .evidence, .data-panel { margin:18px 0 0 52px; }
    h4 { margin:0 0 9px; font-size:14px; }
    .validation ol { margin:0; padding-left:22px; }
    .validation li { margin:5px 0; padding-left:4px; }
    details { border:1px solid var(--line); border-radius:10px; background:#fbfcfe; }
    summary { cursor:pointer; padding:10px 13px; color:#32415a; font-weight:750; user-select:none; }
    details[open] summary { border-bottom:1px solid var(--line); }
    pre { overflow:auto; max-height:520px; margin:0; padding:14px; color:#dce7f8; background:var(--code); font:12px/1.55 "SFMono-Regular", Consolas, monospace; tab-size:2; }
    .event-list { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
    .event-item { border:1px solid var(--line); border-radius:11px; background:#fbfcfe; padding:12px; }
    .event-heading { display:grid; grid-template-columns:28px 1fr; gap:10px; align-items:start; }
    .event-number { display:grid; place-items:center; width:25px; height:25px; border-radius:7px; color:#fff; background:#42516b; font-size:11px; font-weight:800; }
    .event-meta { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .meta-chip { color:#58667b; background:#e9edf3; font-weight:600; }
    .event-item .data-panel { margin:10px 0 0 38px; }
    .count { margin-left:5px; color:#45536a; background:#e8ecf2; }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:10px; }
    table { width:100%; border-collapse:collapse; background:#fff; }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:#526077; background:#f7f9fc; font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
    tr:last-child td { border-bottom:0; }
    .amount { white-space:nowrap; font-weight:800; }
    .amount.positive { color:var(--green); }
    .amount.negative { color:var(--red); }
    .mono { font-family:"SFMono-Regular", Consolas, monospace; font-size:12px; }
    .break { overflow-wrap:anywhere; word-break:break-word; }
    .empty { margin:0; color:var(--muted); }
    .no-results { display:none; padding:38px; color:var(--muted); text-align:center; }
    .no-results.visible { display:block; }
    footer { margin-top:32px; color:var(--muted); text-align:center; }
    @media (max-width:820px) { .summary { grid-template-columns:1fr 1fr; } .metadata, .policy { grid-template-columns:minmax(0, 1fr); } .toolbar { position:static; grid-template-columns:minmax(0, 1fr); } .status-filters { width:100%; overflow:auto; } }
    @media (max-width:560px) { .hero { padding:36px 18px 64px; } main { padding:0 12px 40px; } .summary { grid-template-columns:1fr 1fr; } .test-card { padding:16px 12px; } .test-header { grid-template-columns:1fr; } .test-index { display:none; } .validation, .evidence, .data-panel, .reason { margin-left:0; } .event-item .data-panel { margin-left:0; } }
  </style>
</head>
<body>
  <header class="hero"><div class="hero-inner">
    <div class="kicker">Live-chain integration evidence</div>
    <h1>Vault SDK 主网测试报告</h1>
    <p class="subtitle">展示每个 SDK 接口使用的真实链上数据、验证规则，以及 PTB dry-run 返回的事件和余额变化。</p>
    <div class="summary">
      <div class="metric"><span>测试总数</span><strong>${this.entries.length}</strong></div>
      <div class="metric"><span>通过</span><strong>${passed}</strong></div>
      <div class="metric"><span>跳过</span><strong>${skipped}</strong></div>
      <div class="metric"><span>失败</span><strong>${failed}</strong></div>
    </div>
  </div></header>
  <main>
    <section class="metadata panel">
      <div><span>生成时间</span><code>${escapeHtml(generatedAt)}</code></div>
      <div><span>网络</span><code>${escapeHtml(this.options.network)}</code></div>
      <div><span>接口数量</span><code>${apis.length}</code></div>
      <div><span>GraphQL</span><code title="${escapeHtml(this.options.graphqlUrl)}">${escapeHtml(this.options.graphqlUrl)}</code></div>
      <div><span>gRPC</span><code title="${escapeHtml(this.options.grpcUrl)}">${escapeHtml(this.options.grpcUrl)}</code></div>
      <div><span>报告格式</span><code>Standalone HTML</code></div>
    </section>
    <section class="policy">
      <div><strong>真实数据</strong><br>钱包、Vault、Receipt、请求、事件和余额均来自主网，不使用 mock。</div>
      <div><strong>安全执行</strong><br>所有 PTB 仅执行 dry-run 模拟，不签名，也不提交到链上。</div>
    </section>
    <div class="section-heading"><div><h2>执行上下文</h2><p>本次运行从链上动态发现的钱包和持仓。</p></div></div>
    <section class="context-grid">${contexts}</section>
    <div class="section-heading"><div><h2>接口测试</h2><p>按接口、状态或关键词筛选测试证据。</p></div><strong id="visible-count">${this.entries.length} / ${this.entries.length}</strong></div>
    <section class="toolbar panel">
      <input id="search" type="search" placeholder="搜索接口、测试名称或目的…" aria-label="搜索测试">
      <select id="api-filter" aria-label="按接口筛选"><option value="all">全部接口</option>${apiOptions}</select>
      <div class="status-filters" role="group" aria-label="按状态筛选">
        <button class="active" data-filter="all">全部</button>
        <button data-filter="passed">通过</button>
        <button data-filter="skipped">跳过</button>
        <button data-filter="failed">失败</button>
      </div>
    </section>
    <section class="test-list" id="test-list">${entries}</section>
    <div class="no-results panel" id="no-results">没有符合当前筛选条件的测试。</div>
    <footer>Generated by @naviprotocol/vault live-chain tests</footer>
  </main>
  <script>
    const cards = [...document.querySelectorAll('.test-card')]
    const search = document.querySelector('#search')
    const apiFilter = document.querySelector('#api-filter')
    const buttons = [...document.querySelectorAll('[data-filter]')]
    const visibleCount = document.querySelector('#visible-count')
    const noResults = document.querySelector('#no-results')
    let statusFilter = 'all'
    function applyFilters() {
      const query = search.value.trim().toLowerCase()
      const api = apiFilter.value
      let visible = 0
      for (const card of cards) {
        const matchesStatus = statusFilter === 'all' || card.dataset.status === statusFilter
        const matchesApi = api === 'all' || card.dataset.api === api
        const matchesSearch = !query || card.dataset.search.includes(query)
        const show = matchesStatus && matchesApi && matchesSearch
        card.classList.toggle('hidden', !show)
        if (show) visible += 1
      }
      visibleCount.textContent = visible + ' / ' + cards.length
      noResults.classList.toggle('visible', visible === 0)
    }
    search.addEventListener('input', applyFilters)
    apiFilter.addEventListener('change', applyFilters)
    for (const button of buttons) button.addEventListener('click', () => {
      statusFilter = button.dataset.filter
      for (const item of buttons) item.classList.toggle('active', item === button)
      applyFilters()
    })
  </script>
</body>
</html>
`
  }

  async write() {
    if (!this.enabled) return undefined

    const html = this.html()
    if (this.output === 'stdout') {
      console.log(`\n${html}`)
      return 'stdout'
    }

    await mkdir(dirname(this.output), { recursive: true })
    await writeFile(this.output, html, 'utf8')
    console.log(`\nVault test report written to ${this.output}`)
    return this.output
  }
}
