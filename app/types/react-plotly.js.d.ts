declare module "react-plotly.js" {
  import type { ComponentType, CSSProperties } from "react";

  export type PlotProps = {
    data: unknown[];
    layout?: unknown;
    config?: unknown;
    style?: CSSProperties;
    useResizeHandler?: boolean;
    onClick?: (event: { points: Array<{ customdata?: unknown }> }) => void;
    onAfterPlot?: () => void;
  };

  const Plot: ComponentType<PlotProps>;
  export default Plot;
}

declare module "react-plotly.js/factory" {
  import type { ComponentType } from "react";

  const createPlotlyComponent: (plotly: unknown) => ComponentType<import("react-plotly.js").PlotProps>;
  export default createPlotlyComponent;
}

declare module "plotly.js-dist-min" {
  const Plotly: unknown;
  export default Plotly;
}
