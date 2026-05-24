import createNextIntlPlugin from "next-intl/plugin";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

loadEnvConfig(resolve(process.cwd(), ".."));

const withNextIntl = createNextIntlPlugin();

export default withNextIntl({
  reactStrictMode: true
});
