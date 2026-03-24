// Chart generator for Patient Zero social media posts
// Builds QuickChart.io URLs following the Nuke design system

// --- Types ---

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
  pointRadius?: number;
  tension?: number;
}

export interface ChartConfig {
  type: "bar" | "line" | "scatter" | "horizontalBar" | "doughnut" | "radar";
  labels: string[];
  datasets: ChartDataset[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  stacked?: boolean;
}

// --- Design System Constants ---

const NUKE_PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#059669", // green
  "#d97706", // amber
  "#7c3aed", // purple
  "#db2777", // pink
  "#0891b2", // cyan
  "#65a30d", // lime
  "#ea580c", // orange
  "#4f46e5", // indigo
  "#0d9488", // teal
] as const;

const BACKGROUND_COLOR = "#f5f5f5";
const GRID_COLOR = "#e0e0e0";
const TITLE_COLOR = "#1a1a1a";
const LABEL_COLOR = "#666666";
const TITLE_FONT_SIZE = 14;
const LABEL_FONT_SIZE = 11;
const BORDER_WIDTH = 2;
const FONT_FAMILY = "Arial";
const MONO_FONT = "Courier New";

// --- Internal helpers ---

function assignPaletteColors(
  datasets: ChartDataset[],
  chartType: ChartConfig["type"],
): ChartDataset[] {
  return datasets.map((ds, i) => {
    const color = NUKE_PALETTE[i % NUKE_PALETTE.length];
    const out = { ...ds, borderWidth: ds.borderWidth ?? BORDER_WIDTH };

    if (chartType === "doughnut") {
      // Doughnut: each slice gets a different color from the palette
      out.backgroundColor =
        ds.backgroundColor ??
        ds.data.map((_, j) => NUKE_PALETTE[j % NUKE_PALETTE.length]);
      out.borderColor = ds.borderColor ?? BACKGROUND_COLOR;
    } else if (chartType === "line" || chartType === "radar") {
      out.borderColor = ds.borderColor ?? color;
      out.backgroundColor = ds.backgroundColor ?? color + "33"; // 20% opacity fill
      out.pointRadius = ds.pointRadius ?? 3;
      out.tension = ds.tension ?? 0.3;
    } else if (chartType === "scatter") {
      out.backgroundColor = ds.backgroundColor ?? color;
      out.borderColor = ds.borderColor ?? color;
      out.pointRadius = ds.pointRadius ?? 4;
    } else {
      // bar, horizontalBar
      out.backgroundColor = ds.backgroundColor ?? color;
      out.borderColor = ds.borderColor ?? color;
    }

    return out;
  });
}

function applyNukeTheme(
  config: ChartConfig,
): Record<string, unknown> {
  const datasets = assignPaletteColors(config.datasets, config.type);

  const scaleDefaults: Record<string, unknown> = {
    ticks: {
      fontFamily: MONO_FONT,
      fontSize: LABEL_FONT_SIZE,
      fontColor: LABEL_COLOR,
    },
    gridLines: {
      color: GRID_COLOR,
      zeroLineColor: GRID_COLOR,
    },
  };

  const xAxis: Record<string, unknown> = {
    ...scaleDefaults,
    ...(config.xLabel
      ? {
          scaleLabel: {
            display: true,
            labelString: config.xLabel,
            fontFamily: FONT_FAMILY,
            fontSize: LABEL_FONT_SIZE,
            fontColor: LABEL_COLOR,
          },
        }
      : {}),
    ...(config.stacked ? { stacked: true } : {}),
  };

  const yAxis: Record<string, unknown> = {
    ...scaleDefaults,
    ...(config.yLabel
      ? {
          scaleLabel: {
            display: true,
            labelString: config.yLabel,
            fontFamily: FONT_FAMILY,
            fontSize: LABEL_FONT_SIZE,
            fontColor: LABEL_COLOR,
          },
        }
      : {}),
    ...(config.stacked ? { stacked: true } : {}),
  };

  const chartJsConfig: Record<string, unknown> = {
    type: config.type,
    data: {
      labels: config.labels,
      datasets,
    },
    options: {
      plugins: {
        legend: {
          labels: {
            fontFamily: FONT_FAMILY,
            fontSize: LABEL_FONT_SIZE,
            fontColor: LABEL_COLOR,
          },
        },
        ...(config.title
          ? {
              title: {
                display: true,
                text: config.title,
                fontFamily: FONT_FAMILY,
                fontSize: TITLE_FONT_SIZE,
                fontColor: TITLE_COLOR,
                fontStyle: "bold",
              },
            }
          : {}),
      },
      layout: {
        padding: { top: 10, right: 16, bottom: 10, left: 16 },
      },
      scales:
        config.type === "doughnut" || config.type === "radar"
          ? undefined
          : {
              xAxes: [xAxis],
              yAxes: [yAxis],
            },
      cornerRadius: 0,
      elements: {
        rectangle: { borderWidth: BORDER_WIDTH },
        point: { borderWidth: BORDER_WIDTH },
        line: { borderWidth: BORDER_WIDTH },
        arc: { borderWidth: BORDER_WIDTH },
      },
    },
  };

  return chartJsConfig;
}

// --- Public API ---

export function buildChartUrl(config: ChartConfig): string {
  const chartJsConfig = applyNukeTheme(config);
  const json = JSON.stringify(chartJsConfig);
  const encoded = encodeURIComponent(json);
  const url =
    `https://quickchart.io/chart?c=${encoded}&w=800&h=450&bkg=${encodeURIComponent(BACKGROUND_COLOR)}&f=png`;

  if (url.length > 2048) {
    // URL too long — caller should use buildChartUrlPost instead.
    // Return the URL anyway but log a warning; the sync API can't do POST.
    console.warn(
      `[chartGenerator] URL length ${url.length} exceeds 2048. Use buildChartUrlPost() for reliability.`,
    );
  }

  return url;
}

export async function buildChartUrlPost(
  config: ChartConfig,
): Promise<string> {
  const chartJsConfig = applyNukeTheme(config);

  const res = await fetch("https://quickchart.io/chart/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chart: chartJsConfig,
      width: 800,
      height: 450,
      backgroundColor: BACKGROUND_COLOR,
      format: "png",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `QuickChart POST failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = await res.json() as { success: boolean; url: string };
  if (!data.success || !data.url) {
    throw new Error(`QuickChart returned unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data.url;
}
