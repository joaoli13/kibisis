declare module "react-plotly.js" {
  import type { ComponentType, CSSProperties } from "react";

  type PlotProps = {
    data: unknown[];
    layout?: unknown;
    config?: unknown;
    style?: CSSProperties;
    useResizeHandler?: boolean;
    onClick?: (event: { points: Array<{ customdata?: unknown }> }) => void;
  };

  const Plot: ComponentType<PlotProps>;
  export default Plot;
}
