import * as Plot from '@observablehq/plot';
import { utcMonth } from 'd3';
import { Window } from 'happy-dom';
import { DEFAULT_THEME_NAME, type ThemeMap } from '../config/themes.ts';
import { type PlotActivity, WEEKDAY_LABELS } from './activity.ts';
import {
  appendThemeStyles,
  BOTTOM_MARGIN,
  type CalendarColorScheme,
  type CalendarTheme,
  CELL_BORDER,
  CELL_BORDER_WIDTH,
  CELL_INSET,
  CELL_RADIUS,
  CELL_STEP,
  createContributionTitle,
  createSwatchTitle,
  EMPTY_SVG,
  FONT_SIZE,
  FONT_STACK,
  getThemeFill,
  LABEL_GAP,
  LEFT_MARGIN,
  LEGEND_HEIGHT,
  LEGEND_LABEL_GAP,
  LEGEND_LABEL_WIDTH,
  LEGEND_LABELS,
  LEGEND_RIGHT_PADDING,
  monthFormatter,
  RIGHT_MARGIN,
  SUMMARY_TITLE_FONT_SIZE,
  SUMMARY_TITLE_HEIGHT,
  SUMMARY_TITLE_X,
  SUMMARY_TITLE_Y,
  SVG_NAMESPACE,
  TOP_MARGIN,
  VISIBLE_WEEKDAY_INDICES,
  XLINK_NAMESPACE,
} from './svg-style.ts';

type PlotBandScale = {
  apply: (value: number) => number;
  bandwidth: number;
};

type PlotSvgElement = SVGSVGElement & {
  scale: (name: string) => PlotBandScale | undefined;
};

function createPlotDocument(): Document {
  // Plot is typed against the standard DOM lib, while happy-dom exposes its
  // own compatible classes. Cast once at the integration boundary.
  return new Window().document as unknown as Document;
}

function appendSvgText(
  document: Document,
  parent: SVGElement,
  attributes: Record<string, string>,
  content: string,
): void {
  const text = document.createElementNS(SVG_NAMESPACE, 'text');

  for (const [name, value] of Object.entries(attributes)) {
    text.setAttribute(name, value);
  }

  text.textContent = content;
  parent.append(text);
}

function appendWeekdayLabels(
  svg: PlotSvgElement,
  document: Document,
  textColor: string,
): void {
  const yScale = svg.scale('y');

  if (!yScale) {
    return;
  }

  const labelsGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  labelsGroup.setAttribute('aria-label', 'weekday labels');
  labelsGroup.setAttribute('fill', textColor);

  for (const weekdayIndex of VISIBLE_WEEKDAY_INDICES) {
    const weekdayLabel = WEEKDAY_LABELS[weekdayIndex];

    if (!weekdayLabel) {
      continue;
    }

    appendSvgText(
      document,
      labelsGroup,
      {
        x: String(LEFT_MARGIN + CELL_INSET - LABEL_GAP),
        y: String(yScale.apply(weekdayIndex) + yScale.bandwidth / 2 + 4),
        'text-anchor': 'end',
      },
      weekdayLabel,
    );
  }

  svg.append(labelsGroup);
}

function appendMonthLabels(
  svg: PlotSvgElement,
  document: Document,
  activities: Array<PlotActivity>,
  textColor: string,
  topOffset: number,
): void {
  const xScale = svg.scale('x');

  if (!xScale) {
    return;
  }

  const labelsGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  labelsGroup.setAttribute('aria-label', 'month labels');
  labelsGroup.setAttribute('fill', textColor);

  for (const activity of activities) {
    if (!activity.monthTick) {
      continue;
    }

    const monthDate = utcMonth.floor(new Date(`${activity.date}T00:00:00Z`));

    appendSvgText(
      document,
      labelsGroup,
      {
        x: String(xScale.apply(activity.weekIndex) + CELL_INSET),
        y: String(topOffset + TOP_MARGIN + CELL_INSET - LABEL_GAP),
        'text-anchor': 'start',
      },
      monthFormatter.format(monthDate),
    );
  }

  svg.append(labelsGroup);
}

function getCellTitle(activity: PlotActivity): string {
  const date = new Date(activity.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return createContributionTitle(activity.count, date);
}

function appendSvgTitle(
  svg: SVGElement,
  document: Document,
  title: string,
): void {
  const svgTitle = document.createElementNS(SVG_NAMESPACE, 'title');

  svgTitle.textContent = title;
  svg.append(svgTitle);
}

function appendVisibleSvgTitle(
  svg: SVGElement,
  document: Document,
  title: string,
  textColor: string,
): void {
  appendSvgText(
    document,
    svg,
    {
      x: String(SUMMARY_TITLE_X),
      y: String(SUMMARY_TITLE_Y),
      fill: textColor,
      'font-size': String(SUMMARY_TITLE_FONT_SIZE),
      'text-anchor': 'start',
      'dominant-baseline': 'text-top',
    },
    title,
  );
}

export function renderCalendarSvg(
  activities: Array<PlotActivity>,
  colorScheme: CalendarColorScheme | undefined,
  theme: CalendarTheme,
  availableThemes: ThemeMap,
  svgTitle?: string,
  showVisibleTitle = true,
): string {
  const resolvedTheme =
    availableThemes[theme] ?? availableThemes[DEFAULT_THEME_NAME];

  if (activities.length === 0 || !resolvedTheme) {
    return EMPTY_SVG;
  }

  const document = createPlotDocument();
  const resolvedColorScheme = colorScheme ?? 'light';
  const weekCount =
    Math.max(...activities.map((activity) => activity.weekIndex)) + 1;
  const textColor = 'var(--calendar-text-color)';
  const contentOffsetY =
    svgTitle && showVisibleTitle ? SUMMARY_TITLE_Y + SUMMARY_TITLE_HEIGHT : 0;
  const svgWidth = LEFT_MARGIN + RIGHT_MARGIN + weekCount * CELL_STEP;
  const plotHeight =
    contentOffsetY +
    TOP_MARGIN +
    BOTTOM_MARGIN +
    WEEKDAY_LABELS.length * CELL_STEP;
  const svgHeight = plotHeight + LEGEND_HEIGHT;
  const svg = Plot.plot({
    document,
    width: svgWidth,
    height: plotHeight,
    marginTop: contentOffsetY + TOP_MARGIN,
    marginRight: RIGHT_MARGIN,
    marginBottom: BOTTOM_MARGIN,
    marginLeft: LEFT_MARGIN,
    style: {
      background: 'transparent',
      color: textColor,
      fontFamily: FONT_STACK,
      fontSize: '12px',
    },
    x: {
      axis: null,
      domain: Array.from({ length: weekCount }, (_, index) => index),
      padding: 0,
      round: true,
    },
    y: {
      axis: null,
      domain: Array.from(WEEKDAY_LABELS, (_, index) => index),
      padding: 0,
      round: true,
    },
    color: {
      type: 'ordinal',
      domain: [0, 1, 2, 3, 4],
      range: Array.from({ length: 5 }, (_, index) => getThemeFill(index)),
      legend: false,
    },
    marks: [
      Plot.cell(activities, {
        x: 'weekIndex',
        y: 'weekdayIndex',
        fill: 'level',
        stroke: CELL_BORDER,
        strokeWidth: CELL_BORDER_WIDTH,
        inset: CELL_INSET,
        rx: CELL_RADIUS,
        ry: CELL_RADIUS,
        title: getCellTitle,
      }),
    ],
  }) as PlotSvgElement;

  svg.setAttribute('xmlns', SVG_NAMESPACE);
  svg.setAttribute('xmlns:xlink', XLINK_NAMESPACE);
  svg.setAttribute('class', 'calendar-root');
  svg.setAttribute('fill', textColor);
  svg.setAttribute('font-family', FONT_STACK);
  svg.setAttribute('font-size', String(FONT_SIZE));
  svg.setAttribute('height', String(svgHeight));
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.style.setProperty('background', 'transparent');
  svg.style.setProperty('color', textColor);
  svg.style.setProperty('font-family', FONT_STACK);
  svg.style.setProperty('font-size', `${FONT_SIZE}px`);

  appendThemeStyles(svg, document, resolvedTheme, colorScheme);

  if (svgTitle) {
    appendSvgTitle(svg, document, svgTitle);
  }

  if (svgTitle && showVisibleTitle) {
    appendVisibleSvgTitle(svg, document, svgTitle, textColor);
  }

  appendMonthLabels(svg, document, activities, textColor, contentOffsetY);
  appendWeekdayLabels(svg, document, textColor);

  const legendGroup = document.createElementNS(SVG_NAMESPACE, 'g');
  const legendSwatchWidth = 5 * 10 + 4 * 3;
  const legendMoreX = svgWidth - RIGHT_MARGIN - LEGEND_RIGHT_PADDING;
  const legendSwatchStartX =
    legendMoreX - LEGEND_LABEL_WIDTH - LEGEND_LABEL_GAP - legendSwatchWidth;
  const legendY = plotHeight + 4;

  legendGroup.setAttribute('aria-label', 'legend');
  legendGroup.setAttribute('fill', textColor);

  appendSvgText(
    document,
    legendGroup,
    {
      x: String(legendSwatchStartX - LEGEND_LABEL_GAP),
      y: String(legendY + 9),
      'text-anchor': 'end',
    },
    LEGEND_LABELS.less,
  );

  resolvedTheme[resolvedColorScheme].forEach((_fill, index) => {
    const swatch = document.createElementNS(SVG_NAMESPACE, 'rect');

    swatch.setAttribute('x', String(legendSwatchStartX + index * CELL_STEP));
    swatch.setAttribute('y', String(legendY));
    swatch.setAttribute('width', '10');
    swatch.setAttribute('height', '10');
    swatch.setAttribute('rx', String(CELL_RADIUS));
    swatch.setAttribute('ry', String(CELL_RADIUS));
    swatch.setAttribute('fill', getThemeFill(index));
    swatch.setAttribute('stroke', CELL_BORDER);
    swatch.setAttribute('stroke-width', String(CELL_BORDER_WIDTH));

    const swatchTitle = document.createElementNS(SVG_NAMESPACE, 'title');
    swatchTitle.textContent = createSwatchTitle(index);
    swatch.append(swatchTitle);

    legendGroup.append(swatch);
  });

  appendSvgText(
    document,
    legendGroup,
    {
      x: String(legendMoreX),
      y: String(legendY + 9),
      'text-anchor': 'end',
    },
    LEGEND_LABELS.more,
  );

  svg.append(legendGroup);

  return svg.outerHTML;
}
