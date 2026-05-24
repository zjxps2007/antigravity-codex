export function renderMonitorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Review Gate Monitor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg-start: #030712;
      --bg-end: #090d16;
      --panel: rgba(17, 24, 39, 0.45);
      --panel-hover: rgba(24, 32, 53, 0.65);
      --panel-border: rgba(255, 255, 255, 0.05);
      --panel-border-hover: rgba(99, 102, 241, 0.25);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --ink: #ffffff;

      /* Vibrant Tailored HSL Colors */
      --indigo: 250, 89%, 65%;
      --indigo-glow: rgba(99, 102, 241, 0.15);

      --success: 142, 70%, 45%;
      --success-glow: rgba(16, 185, 129, 0.12);

      --danger: 350, 80%, 55%;
      --danger-glow: rgba(239, 68, 68, 0.12);

      --warning: 38, 92%, 50%;
      --warning-glow: rgba(245, 158, 11, 0.12);

      --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    * {
      box-sizing: border-box;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    body {
      margin: 0;
      background: radial-gradient(circle at 50% 0%, #111827, #030712);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
      position: relative;
      overflow-x: hidden;
    }

    /* Ambient background glow elements */
    body::before {
      content: '';
      position: fixed;
      top: -10%;
      left: 50%;
      transform: translateX(-50%);
      width: 80vw;
      height: 60vh;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0) 70%);
      z-index: -1;
      pointer-events: none;
    }

    body::after {
      content: '';
      position: fixed;
      bottom: -10%;
      right: 5%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(236, 72, 153, 0.03) 0%, rgba(236, 72, 153, 0) 70%);
      z-index: -1;
      pointer-events: none;
    }

    header {
      border-bottom: 1px solid var(--panel-border);
      background: rgba(3, 7, 18, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .wrap {
      width: min(1200px, calc(100vw - 32px));
      margin: 0 auto;
    }

    .top {
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-glow {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 10px;
      color: #a5b4fc;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.2);
    }

    .logo-glow::after {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #a5b4fc);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      opacity: 0.5;
    }

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.025em;
    }

    .sub {
      margin-top: 2px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      background: rgb(16, 185, 129);
      border-radius: 50%;
      position: relative;
      display: inline-block;
    }

    .live-dot::after {
      content: '';
      position: absolute;
      top: -3px;
      left: -3px;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(16, 185, 129, 0.4);
      border-radius: 50%;
      animation: pulse-ring 1.5s cubic-bezier(0.215, 0.610, 0.355, 1) infinite;
    }

    @keyframes pulse-ring {
      0% { transform: scale(0.5); opacity: 1; }
      80%, 100% { transform: scale(1.8); opacity: 0; }
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    button {
      height: 40px;
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      padding: 0 16px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    button:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    button:active {
      transform: translateY(-1px);
    }

    button svg {
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      transition: color 0.2s ease;
    }

    button:hover svg {
      color: var(--text);
    }

    button.primary {
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      border-color: rgba(99, 102, 241, 0.5);
      box-shadow: 0 0 15px var(--indigo-glow), 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    button.primary:hover {
      background: linear-gradient(135deg, #584feb 0%, #7578f5 100%);
      border-color: rgba(99, 102, 241, 0.8);
      box-shadow: 0 0 25px rgba(99, 102, 241, 0.4), 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    button.primary svg {
      color: #ffffff;
    }

    button.toggle {
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.22);
      background: rgba(99, 102, 241, 0.07);
    }

    button.toggle:hover {
      border-color: rgba(99, 102, 241, 0.45);
      background: rgba(99, 102, 241, 0.13);
    }

    button.toggle.active {
      color: #bbf7d0;
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.12);
      box-shadow: 0 0 18px rgba(16, 185, 129, 0.18), 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    button.toggle.active svg {
      color: #86efac;
    }

    button.danger {
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.2);
      background: rgba(239, 68, 68, 0.08);
    }
    button.danger:hover {
      background: rgba(239, 68, 68, 0.16);
      border-color: rgba(239, 68, 68, 0.5);
      color: #ffffff;
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.25);
    }
    button.danger svg {
      color: #fca5a5;
    }
    button.danger:hover svg {
      color: #ffffff;
    }

    main {
      padding: 32px 0 64px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }

    .metric {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 20px;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: center;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
    }

    .metric::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(180deg, #6366f1, #4f46e5);
    }

    .metric.runs-count::before {
      background: linear-gradient(180deg, #10b981, #059669);
    }

    .metric.jobs-count::before {
      background: linear-gradient(180deg, #38bdf8, #2563eb);
    }

    .metric b {
      display: block;
      margin-bottom: 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      font-weight: 700;
    }

    .metric span {
      font-size: 15px;
      font-weight: 600;
      color: var(--ink);
      word-break: break-all;
    }
    .metric.runs-count span {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.1;
      background: linear-gradient(135deg, #ffffff 0%, #10b981 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .metric.jobs-count span {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.1;
      background: linear-gradient(135deg, #ffffff 0%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .diagnostics {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 20px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
    }

    .diagnostics-content {
      max-height: 1000px;
      overflow: hidden;
      transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
      opacity: 1;
    }

    .diagnostics.diagnostics-collapsed .diagnostics-content {
      max-height: 0px !important;
      opacity: 0 !important;
      overflow: hidden;
    }

    .diagnostics.diagnostics-collapsed #diagnostics-chevron {
      transform: rotate(-90deg);
    }

    .diagnostics.diagnostics-collapsed .diagnostics-head {
      border-bottom-color: transparent;
      padding-bottom: 0;
    }

    .diagnostics-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--panel-border);
    }

    .diagnostics-title {
      color: var(--ink);
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .diagnostics-message {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .diagnostics-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .diagnostics-check {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.14);
    }

    .diagnostics-check-name {
      color: var(--ink);
      font-weight: 700;
      font-size: 12px;
    }

    .diagnostics-check-message {
      color: var(--text-muted);
      font-size: 12px;
      word-break: break-word;
    }

    .badge.warn {
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .badge.pass {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .badge.fail {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .badge.skip {
      background: rgba(148, 163, 184, 0.1);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }

    .runs {
      display: grid;
      gap: 20px;
    }

    .run {
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 24px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      position: relative;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .run::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 6px;
      height: 100%;
      border-radius: 16px 0 0 16px;
      background: var(--text-muted);
      transition: all 0.2s ease;
    }

    .run:hover {
      background: var(--panel-hover);
      border-color: var(--panel-border-hover);
      transform: translateY(-3px);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.1);
    }

    .run.allow::before {
      background: rgb(16, 185, 129);
    }
    .run.allow:hover {
      border-color: rgba(16, 185, 129, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(16, 185, 129, 0.08);
    }

    .run.continue::before {
      background: rgb(239, 68, 68);
    }
    .run.continue:hover {
      border-color: rgba(239, 68, 68, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(239, 68, 68, 0.08);
    }
    .run.needs-attention::before {
      background: rgb(56, 189, 248);
    }
    .run.needs-attention:hover {
      border-color: rgba(56, 189, 248, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.08);
    }

    .run.running::before {
      background: rgb(245, 158, 11);
    }
    .run.running:hover {
      border-color: rgba(245, 158, 11, 0.3);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 20px rgba(245, 158, 11, 0.08);
    }

    .run-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      border-bottom: 1px solid var(--panel-border);
      padding-bottom: 16px;
      margin-bottom: 16px;
      cursor: pointer;
      user-select: none;
    }

    .run-head:hover .run-title {
      color: var(--text) !important;
    }

    .run-head:hover .run-chevron {
      color: var(--text) !important;
    }

    .run-chevron {
      color: var(--text-muted);
      transition: transform 0.2s ease, color 0.2s ease;
      flex-shrink: 0;
      margin-top: 4px;
    }

    .run.run-collapsed > *:not(.run-head) {
      display: none !important;
    }

    .run.run-collapsed .run-head {
      border-bottom-color: transparent;
      padding-bottom: 0;
      margin-bottom: 0;
    }

    .run.run-collapsed .run-chevron {
      transform: rotate(-90deg);
    }

    .run-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.015em;
    }

    .run-time {
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      font-family: var(--font-mono);
      background: rgba(255, 255, 255, 0.03);
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--panel-border);
    }

    .badge-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 24px;
      border-radius: 8px;
      padding: 0 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid rgba(255, 255, 255, 0.05);
      gap: 6px;
    }

    .badge.allow {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge.continue {
      background: rgba(56, 189, 248, 0.1);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
    .badge.running {
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .badge.needs-attention {
      background: rgba(56, 189, 248, 0.1);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
    .badge.approve {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge.completed {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge.failed,
    .badge.cancelled {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .badge svg {
      width: 12px;
      height: 12px;
    }

    .summary {
      margin: 16px 0;
      color: var(--text);
      line-height: 1.6;
      font-size: 14.5px;
      background: rgba(255, 255, 255, 0.015);
      padding: 12px 16px;
      border-radius: 10px;
      border-left: 3px solid rgba(255, 255, 255, 0.15);
    }

    .run.allow .summary {
      border-left-color: rgba(16, 185, 129, 0.4);
    }
    .run.continue .summary {
      border-left-color: rgba(239, 68, 68, 0.4);
    }
    .run.needs-attention .summary {
      border-left-color: rgba(56, 189, 248, 0.4);
    }
    .run.running .summary {
      border-left-color: rgba(245, 158, 11, 0.4);
    }

    .event-timeline,
    .logs-container {
      margin-top: 20px;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .event-list,
    .log-list {
      display: grid;
      gap: 8px;
    }

    .event-row {
      display: grid;
      grid-template-columns: 108px minmax(92px, max-content) minmax(0, 1fr);
      gap: 10px;
      align-items: baseline;
      padding: 9px 12px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.16);
    }

    .event-time,
    .event-type,
    .log-label {
      font-family: var(--font-mono);
      font-size: 11px;
    }

    .event-time {
      color: var(--text-muted);
    }

    .event-type {
      color: #c7d2fe;
      font-weight: 700;
      text-transform: uppercase;
    }

    .event-message {
      color: var(--text);
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
    }

    .log-block {
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.16);
    }

    .log-label {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      color: #c7d2fe;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .log-label span:last-child {
      color: var(--text-muted);
      font-weight: 500;
      text-transform: uppercase;
    }

    .log-text {
      max-height: 240px;
    }

    .job-section {
      margin-top: 28px;
    }

    .job-heading {
      margin: 0 0 12px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .findings-container {
      margin-top: 20px;
    }

    .findings-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .findings {
      display: grid;
      gap: 12px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(255, 255, 255, 0.03);
    }

    .finding {
      position: relative;
      padding: 12px 14px 12px 28px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.02);
    }

    .finding::before {
      content: '';
      position: absolute;
      left: 14px;
      top: 18px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      box-shadow: 0 0 8px var(--text-muted);
    }

    .finding.severity-high, .finding.severity-critical {
      border-left: 3px solid rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.02);
    }
    .finding.severity-high::before, .finding.severity-critical::before {
      background: rgb(239, 68, 68);
      box-shadow: 0 0 8px rgb(239, 68, 68);
    }

    .finding.severity-medium {
      border-left: 3px solid rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.02);
    }
    .finding.severity-medium::before {
      background: rgb(245, 158, 11);
      box-shadow: 0 0 8px rgb(245, 158, 11);
    }

    .finding.severity-low {
      border-left: 3px solid rgba(99, 102, 241, 0.4);
      background: rgba(99, 102, 241, 0.02);
    }
    .finding.severity-low::before {
      background: rgb(99, 102, 241);
      box-shadow: 0 0 8px rgb(99, 102, 241);
    }

    .finding-header {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .finding b {
      color: var(--ink);
      font-weight: 600;
      font-size: 14px;
    }

    .location {
      background: rgba(165, 180, 252, 0.1);
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: #a5b4fc;
      border: 1px solid rgba(165, 180, 252, 0.15);
      cursor: pointer;
    }
    .location:hover {
      background: rgba(165, 180, 252, 0.18);
      color: #ffffff;
    }

    .finding-desc {
      margin-top: 6px;
      color: var(--text-muted);
      font-size: 13.5px;
      line-height: 1.5;
    }

    .finding-rec {
      margin-top: 8px;
      font-size: 13px;
      color: #c7d2fe;
      background: rgba(99, 102, 241, 0.06);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(99, 102, 241, 0.1);
    }

    details {
      margin-top: 18px;
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      overflow: hidden;
    }

    summary {
      cursor: pointer;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      padding: 10px 14px;
      outline: none;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.01);
      border-bottom: 1px solid transparent;
    }
    summary:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    details[open] summary {
      border-bottom-color: var(--panel-border);
      background: rgba(255, 255, 255, 0.02);
    }

    pre {
      overflow: auto;
      max-height: 300px;
      background: #02040a;
      color: #e6edf3;
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      margin: 0;
    }

    .close-btn {
      padding: 0 !important;
      width: 24px !important;
      height: 24px !important;
      border-radius: 6px !important;
      min-width: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: rgba(255, 255, 255, 0.05) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      color: var(--text-muted) !important;
      box-shadow: none !important;
    }
    .close-btn:hover {
      background: rgba(239, 68, 68, 0.15) !important;
      border-color: rgba(239, 68, 68, 0.3) !important;
      color: #fca5a5 !important;
      transform: scale(1.05) !important;
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.2) !important;
    }
    .close-btn svg {
      width: 14px !important;
      height: 14px !important;
      color: currentColor !important;
      transition: none !important;
    }

    .empty {
      border: 2px dashed var(--panel-border);
      border-radius: 16px;
      background: var(--panel);
      color: var(--text-muted);
      padding: 64px 32px;
      text-align: center;
      font-size: 15px;
      font-weight: 500;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
    }

    /* Animations */
    @keyframes pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }

    .badge.running {
      animation: pulse 1.8s infinite ease-in-out;
    }

    .spin {
      animation: rotate 1.5s linear infinite;
    }

    @keyframes rotate {
      100% { transform: rotate(360deg); }
    }

    .layout-container {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 28px;
      align-items: start;
      transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .layout-container.sidebar-collapsed {
      grid-template-columns: 1fr 0px;
      gap: 0px;
    }

    .main-content {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 28px;
    }

    .sidebar {
      position: sticky;
      top: 108px;
      max-height: calc(100vh - 140px);
      overflow-y: auto;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      width: 360px;
    }

    .sidebar-inner {
      width: 360px;
    }

    .layout-container.sidebar-collapsed .sidebar {
      opacity: 0;
      pointer-events: none;
      width: 0px;
      transform: translateX(20px);
      overflow: hidden;
    }

    @media (max-width: 1024px) {
      .layout-container {
        grid-template-columns: 1fr !important;
        gap: 28px !important;
      }
      .sidebar {
        position: static;
        width: 100% !important;
        max-height: none;
        opacity: 1 !important;
        pointer-events: auto !important;
        transform: none !important;
      }
      .layout-container.sidebar-collapsed .sidebar {
        display: none;
      }
    }

    @media (max-width: 768px) {
      .top { align-items: flex-start; flex-direction: column; padding: 20px 0; }
      .actions { justify-content: flex-start; width: 100%; }
      .meta { grid-template-columns: 1fr; gap: 12px; }
      .diagnostics-head { flex-direction: column; align-items: flex-start; }
      .diagnostics-grid { grid-template-columns: 1fr; }
      .diagnostics-check { grid-template-columns: 1fr; gap: 4px; }
      .run-head { flex-direction: column; align-items: flex-start; gap: 10px; }
      .run-time { align-self: flex-start; }
      .event-row { grid-template-columns: 1fr; gap: 4px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div class="logo-container">
        <div class="logo-glow">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
        </div>
        <div>
          <h1>Codex Review Gate Monitor</h1>
          <div class="sub">
            <span class="live-dot"></span>
            Local review companion live system
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="refresh" class="primary" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
          Refresh
        </button>
        <button id="auto-refresh" class="toggle" type="button" aria-pressed="false" title="Toggle automatic refresh every 2 seconds">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span class="auto-label">Auto Off</span>
        </button>
        <button id="toggle-sidebar" class="toggle active" type="button" aria-pressed="true" title="Toggle Diagnostics Sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5v15m6-15v15m-6-15h12A2.25 2.25 0 0121 6.75v10.5a2.25 2.25 0 01-2.25 2.25H9M9 4.5H3.75A2.25 2.25 0 001.5 6.75v10.5a2.25 2.25 0 002.25 2.25H9" /></svg>
          <span class="sidebar-btn-label">Hide Diagnostics</span>
        </button>
        <button id="clear" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          Clear Events
        </button>
        <button id="stop" class="danger" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" /></svg>
          Stop Monitor
        </button>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="meta">
      <div class="metric">
        <b>Last Updated</b>
        <span id="updated">Loading...</span>
      </div>
      <div class="metric">
        <b>Events Log Stream</b>
        <span id="events-file">Loading...</span>
      </div>
      <div class="metric runs-count">
        <b>Review Gate Runs</b>
        <span id="run-count">0</span>
      </div>
      <div class="metric jobs-count">
        <b>Codex Jobs</b>
        <span id="job-count">0</span>
      </div>
    </section>

    <div id="layout-container" class="layout-container">
      <div class="main-content">
        <section class="job-section">
          <h2 class="job-heading">Codex Jobs</h2>
          <div id="jobs" class="runs"></div>
        </section>
        <section class="job-section">
          <h2 class="job-heading">Review Gate Runs</h2>
          <div id="runs" class="runs"></div>
        </section>
      </div>
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-inner">
          <section id="diagnostics" class="diagnostics"></section>
        </div>
      </aside>
    </div>
  </main>
  <script>
    const runsEl = document.getElementById('runs');
    const jobsEl = document.getElementById('jobs');
    const updatedEl = document.getElementById('updated');
    const eventsFileEl = document.getElementById('events-file');
    const runCountEl = document.getElementById('run-count');
    const jobCountEl = document.getElementById('job-count');
    const diagnosticsEl = document.getElementById('diagnostics');
    const autoRefreshButton = document.getElementById('auto-refresh');
    const autoRefreshLabel = autoRefreshButton.querySelector('.auto-label');
    let autoRefreshTimer = null;
    let autoRefreshEnabled = false;
    let loading = false;

    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const layoutContainer = document.getElementById('layout-container');
    const sidebarLabel = toggleSidebarBtn.querySelector('.sidebar-btn-label');

    const clipboardHelper = function(text) {
      if (!text) return;
      navigator.clipboard.writeText(text).catch((err) => {
        console.error('Failed to copy to clipboard:', err);
      });
    };
    if (typeof window !== 'undefined') {
      window.copyToClipboard = clipboardHelper;
    } else {
      globalThis.copyToClipboard = clipboardHelper;
    }

    const ICONS = {
      allow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      approve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      continue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      'needs-attention': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>',
      running: '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>',
      pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      finding: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>'
    };

    function h(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function groupEvents(events) {
      const map = new Map();
      for (const event of events) {
        if (!map.has(event.id)) map.set(event.id, []);
        map.get(event.id).push(event);
      }
      return [...map.entries()].map(([id, items]) => {
        items.sort((a, b) => Date.parse(a.time || 0) - Date.parse(b.time || 0));
        return { id, items, last: items[items.length - 1] || {} };
      }).sort((a, b) => Date.parse(b.last.time || 0) - Date.parse(a.last.time || 0));
    }

    function pick(items, type) {
      return [...items].reverse().find((event) => event.type === type);
    }

    function eventTime(value) {
      const date = new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString();
    }

    function eventMessage(event) {
      if (event.message) return event.message;
      if (event.summary) return event.summary;
      if (event.reason) return event.reason;
      if (event.type === 'codex-result') {
        return 'Codex completed with status ' + String(event.status == null ? 'unknown' : event.status) + '.';
      }
      if (event.type === 'decision') {
        return 'Decision: ' + String(event.decision || 'unknown') + '.';
      }
      return '';
    }

    function renderTimeline(items) {
      const rows = items.map((event) => \`
        <div class="event-row">
          <div class="event-time">\${h(eventTime(event.time))}</div>
          <div class="event-type">\${h(event.type || 'event')}</div>
          <div class="event-message">\${h(eventMessage(event))}</div>
        </div>
      \`).join('');
      return \`
        <div class="event-timeline">
          <div class="section-title">Event Timeline</div>
          <div class="event-list">\${rows}</div>
        </div>
      \`;
    }

    function renderLogs(items) {
      const blocks = [];
      for (const event of items) {
        for (const key of ['stdout', 'stderr', 'reason']) {
          if (!event[key]) continue;
          blocks.push({
            type: key,
            eventType: event.type || 'event',
            text: event[key]
          });
        }
      }
      if (!blocks.length) return '';
      const html = blocks.map((block) => \`
        <div class="log-block">
          <div class="log-label">
            <span>\${h(block.eventType)}</span>
            <span>\${h(block.type)}</span>
          </div>
          <pre class="log-text">\${h(block.text)}</pre>
        </div>
      \`).join('');
      return \`
        <div class="logs-container">
          <div class="section-title">Execution Logs</div>
          <div class="log-list">\${html}</div>
        </div>
      \`;
    }

    function renderJob(job) {
      const status = job.status || 'unknown';
      const phase = job.phase || status;
      const updated = job.updatedAt || job.createdAt || job.completedAt;
      const log = job.logTail || '';

      const kindBadge = job.kind ? \`<span class="badge">\${h(job.kind)}</span>\` : '';
      const pidBadge = job.pid ? \`<span class="badge">pid \${h(job.pid)}</span>\` : '';

      let logHtml = '';
      if (log) {
        logHtml = \`
          <div class="logs-container">
            <div class="section-title">Job Log</div>
            <div class="log-list">
              <div class="log-block">
                <div class="log-label">
                  <span>\${h(job.id)}</span>
                  <span>\${h(job.logFile || 'log')}</span>
                </div>
                <pre class="log-text">\${h(log)}</pre>
              </div>
            </div>
          </div>
        \`;
      }

      return \`
        <article class="run \${h(status)}">
          <div class="run-head">
            <div>
              <div class="run-title">\${h(job.title || job.id)}</div>
              <div class="badge-group">
                <span class="badge \${h(status)}">\${h(status)}</span>
                \${kindBadge}
                \${pidBadge}
              </div>
            </div>
            <div class="run-time">\${h(updated ? new Date(updated).toLocaleString() : '')}</div>
          </div>
          <div class="summary">\${h(job.summary || phase)}</div>
          \${logHtml}
          <details>
            <summary>
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
              Raw job payload
            </summary>
            <pre>\${h(JSON.stringify(job, null, 2))}</pre>
          </details>
        </article>
      \`;
    }

    function renderFindings(findings) {
      if (!findings || !findings.length) return '';

      const itemsHtml = findings.map((finding) => {
        const location = finding.file ? finding.file + (finding.line ? ':' + finding.line : '') : '';
        const severityClass = finding.severity ? 'severity-' + finding.severity.toLowerCase() : '';
        const severityLabel = finding.severity ? finding.severity.toUpperCase() : 'FINDING';

        let locationHtml = '';
        if (location) {
          locationHtml = \`<span class="location" title="Click to copy path" onclick="window.copyToClipboard(this.textContent)">\${h(location)}</span>\`;
        }

        let descHtml = '';
        if (finding.description) {
          descHtml = \`<div class="finding-desc">\${h(finding.description)}</div>\`;
        }

        let recHtml = '';
        if (finding.recommendation) {
          recHtml = \`<div class="finding-rec"><b>💡 Recommendation:</b> \${h(finding.recommendation)}</div>\`;
        }

        return \`
          <div class="finding \${h(severityClass)}">
            <div class="finding-header">
              <b>[\${h(severityLabel)}] \${h(finding.title || 'Finding')}</b>
              \${locationHtml}
            </div>
            \${descHtml}
            \${recHtml}
          </div>
        \`;
      }).join('');

      return \`
        <div class="findings-container">
          <div class="findings-title">\${ICONS.finding} Actionable Findings (\${findings.length})</div>
          <div class="findings">\${itemsHtml}</div>
        </div>
      \`;
    }

    function renderRun(run, isFirst) {
      const started = pick(run.items, 'started');
      const result = pick(run.items, 'codex-result');
      const decision = pick(run.items, 'decision');
      const status = decision ? decision.decision : 'running';
      const verdict = (decision && decision.verdict) || (result && result.verdict) || 'pending';
      const summary = (decision && decision.summary) || (result && result.summary) || (started && started.message) || '';
      const findings = (decision && decision.findings) || (result && result.findings) || [];
      const raw = { id: run.id, events: run.items };

      const collapsedState = safeGetItem('run-collapsed-' + run.id);
      const isCollapsed = collapsedState !== null ? collapsedState === 'true' : !isFirst;
      const runClasses = ['run', status, verdict, isCollapsed ? 'run-collapsed' : ''].filter(Boolean).map(h).join(' ');

      const statusIcon = ICONS[status] || '';
      const verdictIcon = ICONS[verdict] || '';

      let summaryHtml = '';
      if (summary) {
        summaryHtml = \`<div class="summary">\${h(summary)}</div>\`;
      }

      return \`
        <article id="run-\${run.id}" class="\${runClasses}">
          <div class="run-head" onclick="window.toggleRunCollapse('\${run.id}')" title="Click to expand/collapse">
            <div style="flex: 1; min-width: 0;">
              <div class="run-title">\${h(started && started.workspace || 'Workspace review')}</div>
              <div class="badge-group">
                <span class="badge \${h(status)}">\${statusIcon}\${h(status)}</span>
                <span class="badge \${h(verdict)}">\${verdictIcon}\${h(verdict)}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="run-time">\${h(new Date(run.last.time || Date.now()).toLocaleString())}</div>
              <svg class="run-chevron" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
            </div>
          </div>
          \${summaryHtml}
          \${renderTimeline(run.items)}
          \${renderFindings(findings)}
          \${renderLogs(run.items)}
          <details>
            <summary>
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
              Raw events payload
            </summary>
            <pre>\${h(JSON.stringify(raw, null, 2))}</pre>
          </details>
        </article>
      \`;
    }

    function renderDiagnostics(diagnostics) {
      if (!diagnostics) {
        return '<div class="diagnostics-message">Diagnostics are unavailable.</div>';
      }
      const checks = diagnostics.checks || [];
      const failed = checks.filter((check) => check.status === 'fail').length;
      const warnings = checks.filter((check) => check.status === 'warn').length;
      const status = failed ? 'fail' : warnings ? 'warn' : 'pass';
      const checksHtml = checks.map((check) => \`
        <div class="diagnostics-check">
          <span class="badge \${h(check.status || 'skip')}">\${h(check.status || 'skip')}</span>
          <div>
            <div class="diagnostics-check-name">\${h(check.name)}</div>
            <div class="diagnostics-check-message">\${h(check.message)}</div>
          </div>
        </div>
      \`).join('');
      const nextSteps = (diagnostics.nextSteps || []).length
        ? '<div class="summary">' + h((diagnostics.nextSteps || []).join('\\n')) + '</div>'
        : '';
      return \`
        <div class="diagnostics-head" style="cursor: pointer;" onclick="window.toggleDiagnosticsContent()" title="Toggle Diagnostics panel">
          <div style="flex: 1; min-width: 0;">
            <div class="diagnostics-title" style="display: flex; align-items: center; gap: 8px;">
              Diagnostics
              <svg id="diagnostics-chevron" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="transition: transform 0.2s ease;"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
            </div>
            <div class="diagnostics-message">\${h(diagnostics.diagnosis || '')}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge \${h(status)}">\${h(status)}</span>
            <button class="close-btn" onclick="event.stopPropagation(); window.toggleSidebarFromInner()" title="Hide Diagnostics Panel" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div class="diagnostics-content">
          <div class="diagnostics-grid" style="margin-top: 14px;">\${checksHtml}</div>
          \${nextSteps}
        </div>
      \`;
    }

    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch('/api/events?limit=200', { cache: 'no-store' });
        const data = await response.json();
        const runs = groupEvents(data.events || []);
        const jobs = data.jobs || [];
        updatedEl.textContent = new Date().toLocaleString();
        eventsFileEl.textContent = data.eventsFile || '';
        runCountEl.textContent = String(runs.length);
        jobCountEl.textContent = String(jobs.length);
        diagnosticsEl.innerHTML = renderDiagnostics(data.diagnostics);
        jobsEl.innerHTML = jobs.length ? jobs.map(renderJob).join('') : '<div class="empty">No Codex jobs found for this workspace.</div>';
        runsEl.innerHTML = runs.length ? runs.map((run, index) => renderRun(run, index === 0)).join('') : '<div class="empty">No review gate runs recorded yet.</div>';
      } finally {
        loading = false;
      }
    }

    function showLoadError(error) {
      runsEl.innerHTML = '<div class="empty">' + h(error.message || error) + '</div>';
      jobsEl.innerHTML = '<div class="empty">' + h(error.message || error) + '</div>';
    }

    function setAutoRefresh(enabled) {
      autoRefreshEnabled = enabled;
      autoRefreshButton.classList.toggle('active', enabled);
      autoRefreshButton.setAttribute('aria-pressed', String(enabled));
      autoRefreshLabel.textContent = enabled ? 'Auto On' : 'Auto Off';
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      if (enabled) {
        autoRefreshTimer = setInterval(() => {
          load().catch(showLoadError);
        }, 2000);
        load().catch(showLoadError);
      }
    }

    function safeGetItem(key) {
      try {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem(key);
        }
      } catch (e) {
        // Handle security / storage restrictions
      }
      return null;
    }

    function safeSetItem(key, value) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, value);
        }
      } catch (e) {
        // Handle security / storage restrictions
      }
    }

    function setSidebarCollapsed(collapsed) {
      layoutContainer.classList.toggle('sidebar-collapsed', collapsed);
      toggleSidebarBtn.classList.toggle('active', !collapsed);
      toggleSidebarBtn.setAttribute('aria-pressed', String(!collapsed));
      sidebarLabel.textContent = collapsed ? 'Show Diagnostics' : 'Hide Diagnostics';
      safeSetItem('sidebar-collapsed', String(collapsed));
    }

    const sidebarState = safeGetItem('sidebar-collapsed');
    setSidebarCollapsed(sidebarState === 'true');

    toggleSidebarBtn.addEventListener('click', () => {
      const currentCollapsed = layoutContainer.classList.contains('sidebar-collapsed');
      setSidebarCollapsed(!currentCollapsed);
    });

    const globalObj = typeof window !== 'undefined' ? window : globalThis;

    globalObj.toggleDiagnosticsContent = function() {
      const isCollapsed = !diagnosticsEl.classList.contains('diagnostics-collapsed');
      diagnosticsEl.classList.toggle('diagnostics-collapsed', isCollapsed);
      safeSetItem('diagnostics-collapsed', String(isCollapsed));
    };

    globalObj.toggleSidebarFromInner = function() {
      const currentCollapsed = layoutContainer.classList.contains('sidebar-collapsed');
      setSidebarCollapsed(!currentCollapsed);
    };

    globalObj.toggleRunCollapse = function(runId) {
      const runEl = document.getElementById('run-' + runId);
      if (!runEl) return;
      const isCollapsed = runEl.classList.contains('run-collapsed');
      if (isCollapsed) {
        runEl.classList.remove('run-collapsed');
        safeSetItem('run-collapsed-' + runId, 'false');
      } else {
        runEl.classList.add('run-collapsed');
        safeSetItem('run-collapsed-' + runId, 'true');
      }
    };

    function initDiagnosticsCollapse() {
      const isCollapsed = safeGetItem('diagnostics-collapsed') !== 'false';
      diagnosticsEl.classList.toggle('diagnostics-collapsed', isCollapsed);
    }

    initDiagnosticsCollapse();

    document.getElementById('refresh').addEventListener('click', () => load().catch(showLoadError));
    autoRefreshButton.addEventListener('click', () => setAutoRefresh(!autoRefreshEnabled));
    document.getElementById('clear').addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all review events?')) {
        await fetch('/api/events', { method: 'DELETE' });
        await load();
      }
    });
    document.getElementById('stop').addEventListener('click', async () => {
      if (confirm('Are you sure you want to stop the review gate monitor?')) {
        await fetch('/api/stop', { method: 'POST' });
        document.body.innerHTML = '<main class="wrap"><div class="empty">Monitor has been stopped. You can safely close this page.</div></main>';
      }
    });
    load().catch((error) => {
      showLoadError(error);
    });
  </script>
</body>
</html>`;
}
