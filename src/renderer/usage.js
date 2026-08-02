(function usageDashboard() {
  "use strict";

  const logic = window.UsageLogic;
  const MIN_RANGE_DAYS = 7;
  const MAX_RANGE_DAYS = 365;
  const DEFAULT_REFRESH_MINUTES = 5;
  const effortOrder = ["low", "medium", "high", "xhigh", "max", "ultra", "unknown"];
  const effortLightness = { low: 76, medium: 68, high: 60, xhigh: 52, max: 44, ultra: 37, unknown: 64 };
  const modelVisuals = {
    "gpt-5.6-sol": { label: "5.6 Sol", hue: 158, saturation: 68 },
    "gpt-5.6-terra": { label: "5.6 Terra", hue: 211, saturation: 82 },
    "gpt-5.6-luna": { label: "5.6 Luna", hue: 255, saturation: 68 },
    "gpt-5.5": { label: "5.5", hue: 40, saturation: 84 },
    "gpt-5.4": { label: "5.4", hue: 7, saturation: 74 }
  };
  const compositionDefinitions = [
    { key: "uncachedInput", label: "输入（未缓存）", lightness: 76 },
    { key: "cachedInput", label: "缓存输入", lightness: 64 },
    { key: "output", label: "输出（含推理）", lightness: 48 }
  ];
  const metricLabels = {
    requests: { title: "每日模型调用", unit: "次 / 天" },
    tokens: { title: "每日 Token 总量", unit: "Tokens / 天" },
    cost: { title: "每日 API 等价费用", unit: "美元 / 天" }
  };
  const state = {
    metric: "tokens",
    tokenMode: "total",
    selectedModel: "gpt-5.6-sol",
    rangeStart: 0,
    rangeEnd: 0,
    expandedModels: new Set(),
    hiddenModels: new Set(),
    rangeDrag: null,
    chartSnapshot: null
  };
  const $ = (id) => document.getElementById(id);
  const elements = {
    metricTabs: $("metricTabs"), tokenModeTabs: $("tokenModeTabs"),
    summaryRequests: $("summaryRequests"), summaryTokens: $("summaryTokens"),
    summaryTokenParts: $("summaryTokenParts"), summaryCache: $("summaryCache"),
    summaryCost: $("summaryCost"), summaryCredits: $("summaryCredits"),
    chartTitle: $("chartTitle"), chartHint: $("chartHint"), chartUnit: $("chartUnit"),
    compositionModelControl: $("compositionModelControl"), compositionModelSelect: $("compositionModelSelect"),
    chart: $("usageChart"), chartWrap: $("chartWrap"), grid: $("gridLayer"),
    series: $("seriesLayer"), axis: $("axisLayer"), hover: $("hoverLayer"),
    tooltip: $("tooltip"), empty: $("emptyState"), legend: $("legend"),
    rangeLabel: $("rangeLabel"), rangeNavigator: $("rangeNavigator"),
    overviewArea: $("overviewArea"), rangeShadeLeft: $("rangeShadeLeft"),
    rangeShadeRight: $("rangeShadeRight"), rangeSelection: $("rangeSelection"),
    rangeStartHandle: $("rangeStartHandle"), rangeEndHandle: $("rangeEndHandle"),
    modelDetails: $("modelDetails"), dataStatus: $("dataStatus"),
    dataStatusTitle: $("dataStatusTitle"), dataStatusText: $("dataStatusText"),
    dataProgressBar: $("dataProgressBar"), dataRetryBtn: $("dataRetryBtn"),
    dataSubtitle: $("dataSubtitle"), usageRefreshBtn: $("usageRefreshBtn"),
    lastUpdatedText: $("lastUpdatedText")
  };

  function dateKey(value) { return logic.localDateKey(value); }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
  function formatNumber(value, digits = 1) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(digits).replace(/\.0+$/, "")}亿`;
    if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(digits).replace(/\.0+$/, "")}万`;
    return Math.round(number).toLocaleString("zh-CN");
  }
  function formatCost(value) { const number = Number(value) || 0; return `$${number.toFixed(number >= 100 ? 1 : 2)}`; }
  function modelVisual(model) { return modelVisuals[model] || { label: model, hue: 170, saturation: 20 }; }
  function modelColor(model, lightness = 58) {
    const visual = modelVisual(model);
    return `hsl(${visual.hue} ${visual.saturation}% ${lightness}%)`;
  }
  function effortColor(model, effort) { return modelColor(model, effortLightness[effort] || effortLightness.unknown); }
  function compositionColor(model, definition) { return modelColor(model, definition.lightness); }
  function metricValue(row) { return state.metric === "requests" ? row.requests : state.metric === "cost" ? row.cost : row.total; }

  function dateSequence(start, end) {
    const dates = [];
    const cursor = new Date(`${start}T12:00:00`);
    const last = new Date(`${end}T12:00:00`);
    while (cursor <= last) { dates.push(dateKey(cursor)); cursor.setDate(cursor.getDate() + 1); }
    return dates;
  }

  let allDates = [];
  let allRows = [];
  let loadingUsage = false;
  let lastLoadedAt = 0;
  let suppressProgress = false;
  let autoRefreshTimer = null;

  function currentDates() { return allDates.slice(state.rangeStart, state.rangeEnd + 1); }
  function currentRows() {
    if (!allDates.length) return [];
    const start = allDates[state.rangeStart];
    const end = allDates[state.rangeEnd];
    return allRows.filter((row) => row.date >= start && row.date <= end);
  }
  function setRange(start, end) {
    const normalized = logic.normalizeIndexWindow(start, end, allDates.length, MIN_RANGE_DAYS, MAX_RANGE_DAYS);
    state.rangeStart = normalized.start;
    state.rangeEnd = normalized.end;
  }

  function emptyDailyRow(date, model, effort) {
    return { date, model, effort, requests: 0, pricedRequests: 0, uncachedInput: 0, cachedInput: 0, input: 0, output: 0, total: 0, cost: 0, credits: 0 };
  }
  function buildTotalLayers(rows, dates) {
    const bySeries = new Map();
    rows.forEach((row) => {
      const key = `${row.model}|${row.effort}`;
      if (!bySeries.has(key)) bySeries.set(key, { model: row.model, effort: row.effort, byDate: new Map() });
      bySeries.get(key).byDate.set(row.date, row);
    });
    const modelOrder = Object.keys(modelVisuals);
    return [...bySeries.values()].sort((a, b) => {
      const modelDifference = modelOrder.indexOf(a.model) - modelOrder.indexOf(b.model);
      return modelDifference || effortOrder.indexOf(a.effort) - effortOrder.indexOf(b.effort);
    }).map((series) => ({
      key: `${series.model}|${series.effort}`,
      model: series.model,
      effort: series.effort,
      label: `${modelVisual(series.model).label} · ${series.effort}`,
      color: effortColor(series.model, series.effort),
      rows: dates.map((date) => series.byDate.get(date) || emptyDailyRow(date, series.model, series.effort))
    }));
  }
  function buildCompositionLayers(rows, dates) {
    const selectedRows = rows.filter((row) => row.model === state.selectedModel);
    const daily = new Map(dates.map((date) => [date, emptyDailyRow(date, state.selectedModel, "all")]));
    selectedRows.forEach((row) => {
      const target = daily.get(row.date);
      for (const field of ["requests", "pricedRequests", "uncachedInput", "cachedInput", "input", "output", "total", "cost", "credits"]) target[field] += Number(row[field]) || 0;
    });
    return compositionDefinitions.map((definition) => ({
      key: definition.key,
      model: state.selectedModel,
      effort: null,
      label: definition.label,
      color: compositionColor(state.selectedModel, definition),
      rows: dates.map((date) => daily.get(date)),
      valueField: definition.key
    }));
  }
  function stackLayers(rawLayers) {
    if (!rawLayers.length) return [];
    const baseline = rawLayers[0].rows.map(() => 0);
    return rawLayers.map((layer) => {
      const lower = [...baseline];
      const values = layer.rows.map((row) => layer.valueField ? row[layer.valueField] : metricValue(row));
      const upper = values.map((value, index) => {
        baseline[index] += Number(value) || 0;
        return baseline[index];
      });
      return { ...layer, values, lower, upper };
    });
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }
  function monotonePath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
    const slopes = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const dx = points[index + 1][0] - points[index][0];
      slopes.push(dx ? (points[index + 1][1] - points[index][1]) / dx : 0);
    }
    const tangents = points.map((_, index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes[slopes.length - 1];
      if (slopes[index - 1] * slopes[index] <= 0) return 0;
      return (slopes[index - 1] + slopes[index]) / 2;
    });
    for (let index = 0; index < slopes.length; index += 1) {
      if (!slopes[index]) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
      const alpha = tangents[index] / slopes[index];
      const beta = tangents[index + 1] / slopes[index];
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[index] = scale * alpha * slopes[index];
        tangents[index + 1] = scale * beta * slopes[index];
      }
    }
    let path = `M ${points[0][0]} ${points[0][1]}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const dx = next[0] - current[0];
      path += ` C ${current[0] + dx / 3} ${current[1] + tangents[index] * dx / 3}, ${next[0] - dx / 3} ${next[1] - tangents[index + 1] * dx / 3}, ${next[0]} ${next[1]}`;
    }
    return path;
  }
  function areaPath(top, bottom) {
    return `${monotonePath(top)}${monotonePath([...bottom].reverse()).replace(/^M/, " L")} Z`;
  }

  function renderSummary(rows) {
    const summary = logic.summarize(rows);
    elements.summaryRequests.textContent = formatNumber(summary.requests);
    elements.summaryTokens.textContent = formatNumber(summary.total, 2);
    elements.summaryTokenParts.textContent = `输入 ${formatNumber(summary.input)} · 输出 ${formatNumber(summary.output)}`;
    elements.summaryCache.textContent = `${(summary.cacheHitRate * 100).toFixed(1)}%`;
    elements.summaryCost.textContent = formatCost(summary.cost);
    elements.summaryCredits.textContent = `${summary.credits.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} credits${summary.unpricedRequests ? ` · ${formatNumber(summary.unpricedRequests)} 次无公开价` : ""}`;
  }

  function renderLegend(layers, availableModels) {
    elements.legend.replaceChildren();
    const title = document.createElement("div");
    title.className = "legend-title";
    title.textContent = state.metric === "tokens" && state.tokenMode === "composition" ? "官方三类 Token" : "模型";
    elements.legend.append(title);
    if (state.metric === "tokens" && state.tokenMode === "composition") {
      layers.forEach((layer) => {
        const item = document.createElement("div");
        item.className = "legend-item";
        item.style.setProperty("--series-color", layer.color);
        item.innerHTML = `<span class="legend-swatch"></span><span>${escapeHtml(layer.label)}</span>`;
        elements.legend.append(item);
      });
      return;
    }
    availableModels.forEach((model) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "legend-item legend-toggle";
      item.classList.toggle("is-hidden", state.hiddenModels.has(model));
      item.setAttribute("aria-pressed", String(!state.hiddenModels.has(model)));
      item.setAttribute("aria-label", `${state.hiddenModels.has(model) ? "显示" : "隐藏"} ${modelVisual(model).label}`);
      item.style.setProperty("--shade-light", modelColor(model, 76));
      item.style.setProperty("--shade-dark", modelColor(model, 37));
      item.innerHTML = `<span class="legend-gradient"></span><span>${escapeHtml(modelVisual(model).label)}</span>`;
      item.addEventListener("click", () => {
        if (state.hiddenModels.has(model)) state.hiddenModels.delete(model);
        else state.hiddenModels.add(model);
        renderAll();
      });
      elements.legend.append(item);
    });
  }

  function renderAxes(dates, maximum, plot) {
    elements.grid.replaceChildren();
    elements.axis.replaceChildren();
    for (let step = 0; step <= 4; step += 1) {
      const y = plot.top + plot.height * step / 4;
      elements.grid.append(svgElement("line", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y, class: "grid-line" }));
      const label = svgElement("text", { x: plot.left - 10, y: y + 3, "text-anchor": "end", class: "axis-label" });
      const value = maximum * (1 - step / 4);
      label.textContent = state.metric === "cost" ? `$${value.toFixed(value < 10 ? 2 : 0)}` : formatNumber(value);
      elements.axis.append(label);
    }
    const tickIndices = logic.uniformTickIndices(dates.length, plot.width, 64);
    for (const index of tickIndices) {
      const x = plot.left + (dates.length <= 1 ? plot.width / 2 : plot.width * index / (dates.length - 1));
      const label = svgElement("text", { x, y: plot.top + plot.height + 25, "text-anchor": "middle", class: "axis-label" });
      label.textContent = dates[index].slice(5).replace("-", "/");
      elements.axis.append(label);
    }
  }

  function renderChart(rows, dates) {
    const compositionMode = state.metric === "tokens" && state.tokenMode === "composition";
    const availableModels = [...new Set(rows.map((row) => row.model))];
    const visibleRows = compositionMode ? rows : rows.filter((row) => !state.hiddenModels.has(row.model));
    const rawLayers = compositionMode ? buildCompositionLayers(rows, dates) : buildTotalLayers(visibleRows, dates);
    const layers = stackLayers(rawLayers);
    const plot = { left: 68, top: 18, width: 728, height: 320 };
    const maximum = Math.max(1, ...(layers.length ? layers[layers.length - 1].upper : [0])) * 1.08;
    const xAt = (index) => plot.left + (dates.length <= 1 ? plot.width / 2 : plot.width * index / (dates.length - 1));
    const yAt = (value) => plot.top + plot.height - value / maximum * plot.height;
    elements.series.replaceChildren();
    elements.hover.replaceChildren();
    elements.tooltip.hidden = true;
    renderAxes(dates, maximum, plot);
    renderLegend(layers, availableModels);
    layers.forEach((layer) => {
      const top = layer.upper.map((value, index) => [xAt(index), yAt(value)]);
      const bottom = layer.lower.map((value, index) => [xAt(index), yAt(value)]);
      const path = svgElement("path", { d: areaPath(top, bottom), fill: layer.color, class: "series-area", "data-layer-key": layer.key });
      elements.series.append(path);
    });
    const hitbox = svgElement("rect", { x: plot.left, y: plot.top, width: plot.width, height: plot.height, class: "chart-hitbox" });
    elements.series.append(hitbox);
    state.chartSnapshot = { rows, dates, layers, plot, maximum };
    elements.empty.textContent = rows.length && !layers.length ? "所有模型均已隐藏" : "所选日期内没有数据";
    elements.empty.hidden = Boolean(layers.length && dates.length);
    elements.chart.style.opacity = layers.length && dates.length ? "1" : ".25";
    hitbox.addEventListener("pointermove", handleChartPointerMove);
    hitbox.addEventListener("pointerleave", clearChartHover);
  }

  function clearChartHover() {
    elements.hover.replaceChildren();
    elements.tooltip.hidden = true;
    elements.series.querySelectorAll(".series-area.hovered").forEach((path) => path.classList.remove("hovered"));
  }
  function handleChartPointerMove(event) {
    const snapshot = state.chartSnapshot;
    if (!snapshot?.dates.length) return;
    const svgRect = elements.chart.getBoundingClientRect();
    const svgX = (event.clientX - svgRect.left) * 820 / svgRect.width;
    const svgY = (event.clientY - svgRect.top) * 390 / svgRect.height;
    const ratio = clamp((svgX - snapshot.plot.left) / snapshot.plot.width, 0, 1);
    const dateIndex = Math.round(ratio * Math.max(0, snapshot.dates.length - 1));
    const valueAtPointer = (snapshot.plot.top + snapshot.plot.height - svgY) / snapshot.plot.height * snapshot.maximum;
    const layer = [...snapshot.layers].reverse().find((candidate) => valueAtPointer >= candidate.lower[dateIndex] && valueAtPointer <= candidate.upper[dateIndex] && candidate.values[dateIndex] > 0) || null;
    elements.series.querySelectorAll(".series-area").forEach((path) => path.classList.toggle("hovered", path.dataset.layerKey === layer?.key));
    const x = snapshot.plot.left + (snapshot.dates.length <= 1 ? snapshot.plot.width / 2 : snapshot.plot.width * dateIndex / (snapshot.dates.length - 1));
    elements.hover.replaceChildren(svgElement("line", { x1: x, y1: snapshot.plot.top, x2: x, y2: snapshot.plot.top + snapshot.plot.height, class: "hover-rule" }));
    showTooltip(event, snapshot.dates[dateIndex], dateIndex, layer);
  }
  function showTooltip(event, date, dateIndex, layer) {
    const snapshot = state.chartSnapshot;
    const rowsAtDate = snapshot.rows.filter((row) => row.date === date);
    const compositionMode = state.metric === "tokens" && state.tokenMode === "composition";
    const daily = logic.summarize(compositionMode ? rowsAtDate.filter((row) => row.model === state.selectedModel) : rowsAtDate);
    const focusValue = layer ? layer.values[dateIndex] : 0;
    let focus = "";
    if (layer) {
      const identity = layer.effort ? `${modelVisual(layer.model).label} · ${layer.effort}` : `${modelVisual(layer.model).label} · ${layer.label}`;
      const formatted = state.metric === "cost" ? formatCost(focusValue) : formatNumber(focusValue);
      focus = `<div class="tooltip-focus"><div class="tooltip-row"><span>${escapeHtml(identity)}</span><b>${formatted}</b></div></div>`;
    }
    elements.tooltip.innerHTML = `<strong>${date}</strong>${focus}<div class="tooltip-row"><span>${compositionMode ? "所选模型总量" : "当日总量"}</span><b>${state.metric === "cost" ? formatCost(daily.cost) : state.metric === "requests" ? formatNumber(daily.requests) : formatNumber(daily.total)}</b></div><div class="tooltip-row"><span>模型调用</span><b>${formatNumber(daily.requests)}</b></div><div class="tooltip-row"><span>缓存命中率</span><b>${(daily.cacheHitRate * 100).toFixed(1)}%</b></div>`;
    elements.tooltip.hidden = false;
    const wrapRect = elements.chartWrap.getBoundingClientRect();
    const tooltipWidth = 226;
    const localX = event.clientX - wrapRect.left;
    const localY = event.clientY - wrapRect.top;
    const left = localX + tooltipWidth + 20 <= wrapRect.width ? localX + 13 : localX - tooltipWidth - 13;
    const top = clamp(localY - 28, 6, Math.max(6, wrapRect.height - 142));
    elements.tooltip.style.transform = `translate(${Math.max(6, left)}px, ${top}px)`;
  }

  function renderOverview() {
    const totalsByDate = new Map(allDates.map((date) => [date, 0]));
    allRows.forEach((row) => totalsByDate.set(row.date, totalsByDate.get(row.date) + row.total));
    const values = allDates.map((date) => totalsByDate.get(date));
    const maximum = Math.max(1, ...values);
    const top = values.map((value, index) => [allDates.length <= 1 ? 410 : index * 820 / (allDates.length - 1), 68 - value / maximum * 60]);
    const bottom = values.map((_, index) => [allDates.length <= 1 ? 410 : index * 820 / (allDates.length - 1), 70]);
    elements.overviewArea.setAttribute("d", areaPath(top, bottom));
  }
  function renderRangeNavigator() {
    if (!allDates.length) return;
    const denominator = Math.max(1, allDates.length - 1);
    const left = state.rangeStart / denominator * 100;
    const right = state.rangeEnd / denominator * 100;
    elements.rangeSelection.style.left = `${left}%`;
    elements.rangeSelection.style.width = `${Math.max(.8, right - left)}%`;
    elements.rangeShadeLeft.style.width = `${left}%`;
    elements.rangeShadeRight.style.width = `${Math.max(0, 100 - right)}%`;
    elements.rangeLabel.textContent = `${allDates[state.rangeStart]} → ${allDates[state.rangeEnd]} · ${state.rangeEnd - state.rangeStart + 1} 天`;
    elements.rangeSelection.setAttribute("aria-valuemin", "0");
    elements.rangeSelection.setAttribute("aria-valuemax", String(allDates.length - 1));
    elements.rangeSelection.setAttribute("aria-valuenow", String(state.rangeStart));
    elements.rangeSelection.setAttribute("aria-valuetext", elements.rangeLabel.textContent);
  }

  function rangeIndexFromPointer(event) {
    const rect = elements.rangeNavigator.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(1, rect.width) * (allDates.length - 1), 0, allDates.length - 1);
  }
  function beginRangeDrag(event) {
    if (event.button !== 0) return;
    const mode = event.target === elements.rangeStartHandle ? "start" : event.target === elements.rangeEndHandle ? "end" : elements.rangeSelection.contains(event.target) ? "move" : "center";
    const pointerIndex = rangeIndexFromPointer(event);
    if (mode === "center") {
      const days = state.rangeEnd - state.rangeStart + 1;
      let start = Math.round(pointerIndex - (days - 1) / 2);
      start = clamp(start, 0, allDates.length - days);
      setRange(start, start + days - 1);
      renderAll();
    }
    state.rangeDrag = { mode: mode === "center" ? "move" : mode, pointerId: event.pointerId, pointerIndex, start: state.rangeStart, end: state.rangeEnd };
    elements.rangeNavigator.setPointerCapture(event.pointerId);
    elements.rangeSelection.classList.add("dragging");
    event.preventDefault();
  }
  function moveRangeDrag(event) {
    const drag = state.rangeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointerIndex = rangeIndexFromPointer(event);
    const minimumGap = Math.min(MIN_RANGE_DAYS, allDates.length) - 1;
    const maximumGap = Math.min(MAX_RANGE_DAYS, allDates.length) - 1;
    if (drag.mode === "start") {
      state.rangeStart = clamp(Math.round(pointerIndex), Math.max(0, state.rangeEnd - maximumGap), state.rangeEnd - minimumGap);
    } else if (drag.mode === "end") {
      state.rangeEnd = clamp(Math.round(pointerIndex), state.rangeStart + minimumGap, Math.min(allDates.length - 1, state.rangeStart + maximumGap));
    } else {
      const span = drag.end - drag.start;
      const delta = Math.round(pointerIndex - drag.pointerIndex);
      const start = clamp(drag.start + delta, 0, allDates.length - 1 - span);
      state.rangeStart = start;
      state.rangeEnd = start + span;
    }
    renderAll();
    event.preventDefault();
  }
  function endRangeDrag(event) {
    if (!state.rangeDrag || state.rangeDrag.pointerId !== event.pointerId) return;
    state.rangeDrag = null;
    elements.rangeSelection.classList.remove("dragging");
    if (elements.rangeNavigator.hasPointerCapture(event.pointerId)) elements.rangeNavigator.releasePointerCapture(event.pointerId);
  }
  function zoomRange(event) {
    event.preventDefault();
    const currentDays = state.rangeEnd - state.rangeStart + 1;
    const maximum = Math.min(MAX_RANGE_DAYS, allDates.length);
    const targetDays = clamp(Math.round(currentDays * (event.deltaY < 0 ? .8 : 1.25)), Math.min(MIN_RANGE_DAYS, allDates.length), maximum);
    if (targetDays === currentDays) return;
    const rect = elements.chart.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const anchor = state.rangeStart + ratio * Math.max(0, currentDays - 1);
    let start = Math.round(anchor - ratio * Math.max(0, targetDays - 1));
    start = clamp(start, 0, allDates.length - targetDays);
    setRange(start, start + targetDays - 1);
    renderAll();
  }

  function renderDetails(rows) {
    const models = logic.aggregateModels(rows);
    elements.modelDetails.replaceChildren();
    models.forEach((item) => {
      const card = document.createElement("article");
      card.className = "model-detail";
      card.classList.toggle("expanded", state.expandedModels.has(item.model));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-summary";
      button.style.setProperty("--series-color", modelColor(item.model, 58));
      button.setAttribute("aria-expanded", String(state.expandedModels.has(item.model)));
      const modelCost = item.summary.pricedRequests ? formatCost(item.summary.cost) : "无公开价";
      button.innerHTML = `<div class="model-summary-top"><span class="model-name"><span class="model-dot"></span>${escapeHtml(modelVisual(item.model).label)}</span><span class="expand-icon">›</span></div><div class="model-summary-meta"><span>调用 <strong>${formatNumber(item.summary.requests)}</strong></span><span>Tokens <strong>${formatNumber(item.summary.total)}</strong></span><span><strong>${modelCost}</strong></span></div>`;
      button.addEventListener("click", () => {
        if (state.expandedModels.has(item.model)) state.expandedModels.delete(item.model);
        else state.expandedModels.add(item.model);
        renderDetails(rows);
      });
      const list = document.createElement("div");
      list.className = "effort-list";
      item.efforts.sort((a, b) => effortOrder.indexOf(a.effort) - effortOrder.indexOf(b.effort)).forEach((effort) => {
        const row = document.createElement("div");
        row.className = "effort-row";
        row.style.setProperty("--series-color", effortColor(item.model, effort.effort));
        const effortCost = effort.summary.pricedRequests ? formatCost(effort.summary.cost) : "无公开价";
        row.innerHTML = `<span class="effort-label"><span class="effort-mark"></span>${escapeHtml(effort.effort)}</span><span>${formatNumber(effort.summary.requests)} 次 · <b>${formatNumber(effort.summary.total)}</b> · ${effortCost}</span>`;
        list.append(row);
      });
      card.append(button, list);
      elements.modelDetails.append(card);
    });
  }

  function renderAll() {
    const dates = currentDates();
    const rows = currentRows();
    const compositionMode = state.metric === "tokens" && state.tokenMode === "composition";
    elements.metricTabs.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.metric === state.metric));
    elements.tokenModeTabs.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.tokenMode === state.tokenMode));
    elements.tokenModeTabs.hidden = state.metric !== "tokens";
    elements.compositionModelControl.hidden = !compositionMode;
    elements.chartTitle.textContent = compositionMode ? "每日 Token 组成" : metricLabels[state.metric].title;
    elements.chartHint.textContent = compositionMode ? "所有 effort 已合并；显示官方三类 Token" : state.metric === "cost" ? "无公开API价格的内部模型不计入金额" : "模型使用不同色系，同一模型的 effort 使用不同明度";
    elements.chartUnit.textContent = metricLabels[state.metric].unit;
    renderSummary(rows);
    renderChart(rows, dates);
    renderRangeNavigator();
    renderDetails(rows);
  }

  function initModelSelect() {
    const presentModels = [...new Set(allRows.map((row) => row.model))];
    elements.compositionModelSelect.innerHTML = presentModels.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(modelVisual(model).label)}</option>`).join("");
    if (!presentModels.includes(state.selectedModel)) state.selectedModel = presentModels[0];
    elements.compositionModelSelect.value = state.selectedModel;
  }

  function showDataProgress(progress = {}) {
    elements.dataStatus.hidden = false;
    elements.dataStatus.classList.remove("error");
    elements.dataRetryBtn.hidden = true;
    elements.dataStatusTitle.textContent = progress.phase === "complete" ? "用量索引已更新" : "正在建立用量索引";
    const files = Number(progress.filesTotal) || 0;
    const completed = Number(progress.filesDone) || 0;
    elements.dataStatusText.textContent = files ? `已处理 ${completed} / ${files} 个日志文件` : "正在查找 Codex 会话日志";
    elements.dataProgressBar.style.width = `${clamp(Number(progress.percent) || 0, 0, 100)}%`;
  }

  function showDataError(error) {
    elements.dataStatus.hidden = false;
    elements.dataStatus.classList.add("error");
    elements.dataStatusTitle.textContent = "真实用量读取失败";
    elements.dataStatusText.textContent = error?.message || String(error);
    elements.dataRetryBtn.hidden = false;
    elements.dataSubtitle.textContent = "未能读取本地 Codex 日志";
  }

  function previewUsageBridge() {
    if (window.codexUsage?.getUsageData) return window.codexUsage;
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    if (window.location.protocol !== "http:" || !loopbackHosts.has(window.location.hostname)) return null;
    return {
      getUsageData: async () => {
        const response = await fetch("/api/usage", { cache: "no-store", credentials: "omit" });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `真实用量读取失败（${response.status}）`);
        return data;
      },
      onProgress: () => () => {}
      ,getRefreshIntervalMinutes: async () => DEFAULT_REFRESH_MINUTES
      ,onRefresh: () => () => {}
      ,onRefreshIntervalChanged: () => () => {}
    };
  }

  function scheduleAutoRefresh(minutes = DEFAULT_REFRESH_MINUTES) {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    const normalizedMinutes = Math.max(1 / 6, Number(minutes) || DEFAULT_REFRESH_MINUTES);
    autoRefreshTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadRealUsage({ background: true });
    }, normalizedMinutes * 60 * 1000);
  }

  async function loadRealUsage({ background = false } = {}) {
    if (loadingUsage) return;
    const usageBridge = previewUsageBridge();
    if (!usageBridge) {
      showDataError(new Error("请从 ChatGPT Quota 挂件的“查看 Token 消耗”入口打开此页面。"));
      return;
    }
    const previousStartDate = allDates[state.rangeStart];
    const previousEndDate = allDates[state.rangeEnd];
    const previousLastDate = allDates[allDates.length - 1];
    loadingUsage = true;
    elements.usageRefreshBtn.disabled = true;
    elements.usageRefreshBtn.classList.add("loading");
    suppressProgress = background;
    if (!background) showDataProgress({ percent: 0 });
    try {
      const data = await usageBridge.getUsageData();
      const events = Array.isArray(data?.events) ? data.events : [];
      if (!events.length) throw new Error("Codex 日志中尚未找到有效 Token 记录。");
      const eventDates = events.map((event) => dateKey(event.timestamp)).filter(Boolean).sort();
      const firstDate = eventDates[0];
      const lastDate = eventDates[eventDates.length - 1];
      allDates = dateSequence(firstDate, lastDate);
      allRows = logic.aggregateEvents(events, firstDate, lastDate);
      if (previousStartDate && previousEndDate) {
        const start = Math.max(0, allDates.indexOf(previousStartDate));
        const end = previousEndDate === previousLastDate ? allDates.length - 1 : Math.max(start, allDates.indexOf(previousEndDate));
        setRange(start, end);
      } else {
        setRange(Math.max(0, allDates.length - MAX_RANGE_DAYS), allDates.length - 1);
      }
      initModelSelect();
      renderOverview();
      renderAll();
      lastLoadedAt = Date.now();
      elements.lastUpdatedText.textContent = `更新于 ${new Date(lastLoadedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      if (!background) {
        elements.dataProgressBar.style.width = "100%";
        elements.dataStatusTitle.textContent = "真实用量已载入";
        const retained = Number(data.archivedFiles) || 0;
        const retainedText = retained ? ` · 保留 ${retained} 个已归档日志的历史` : "";
        elements.dataStatusText.textContent = `${data.filesIndexed || 0} 个现存日志文件${retainedText} · ${events.length.toLocaleString("zh-CN")} 次有效模型调用`;
      }
      elements.dataSubtitle.textContent = `${firstDate} 至 ${lastDate} · 本机日志合计 · 不区分账号`;
      if (!background) setTimeout(() => { elements.dataStatus.hidden = true; }, 1600);
    } catch (error) {
      showDataError(error);
    } finally {
      suppressProgress = false;
      loadingUsage = false;
      elements.usageRefreshBtn.disabled = false;
      elements.usageRefreshBtn.classList.remove("loading");
    }
  }
  function wireEvents() {
    elements.metricTabs.addEventListener("click", (event) => {
      const metric = event.target.closest("button")?.dataset.metric;
      if (metric) { state.metric = metric; renderAll(); }
    });
    elements.tokenModeTabs.addEventListener("click", (event) => {
      const mode = event.target.closest("button")?.dataset.tokenMode;
      if (mode) { state.tokenMode = mode; renderAll(); }
    });
    elements.compositionModelSelect.addEventListener("change", () => { state.selectedModel = elements.compositionModelSelect.value; renderAll(); });
    elements.dataRetryBtn.addEventListener("click", () => loadRealUsage());
    elements.usageRefreshBtn.addEventListener("click", () => loadRealUsage());
    elements.rangeNavigator.addEventListener("pointerdown", beginRangeDrag);
    elements.rangeNavigator.addEventListener("pointermove", moveRangeDrag);
    elements.rangeNavigator.addEventListener("pointerup", endRangeDrag);
    elements.rangeNavigator.addEventListener("pointercancel", endRangeDrag);
    elements.chart.addEventListener("wheel", zoomRange, { passive: false });
    elements.rangeSelection.addEventListener("keydown", (event) => {
      if (!(["ArrowLeft", "ArrowRight"].includes(event.key))) return;
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const span = state.rangeEnd - state.rangeStart;
      const start = clamp(state.rangeStart + delta, 0, allDates.length - 1 - span);
      state.rangeStart = start;
      state.rangeEnd = start + span;
      renderAll();
      event.preventDefault();
    });
  }
  function init() {
    const usageBridge = previewUsageBridge();
    usageBridge?.onProgress?.((progress) => {
      if (!suppressProgress) showDataProgress(progress);
    });
    usageBridge?.onRefresh?.(() => loadRealUsage({ background: true }));
    usageBridge?.onRefreshIntervalChanged?.((minutes) => scheduleAutoRefresh(minutes));
    usageBridge?.getRefreshIntervalMinutes?.().then(scheduleAutoRefresh).catch(() => scheduleAutoRefresh());
    wireEvents();
    loadRealUsage();
    window.addEventListener("focus", () => loadRealUsage({ background: true }));
  }

  init();
})();
