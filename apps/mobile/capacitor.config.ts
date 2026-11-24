import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mizurisu.agent",
  appName: "Mizurisu Agent",
  webDir: "../../packages/app/dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
